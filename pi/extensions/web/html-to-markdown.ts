/**
 * Dependency-free HTML to Markdown-ish text conversion for `fleet_web_fetch`.
 *
 * It keeps what a model needs from a documentation page (headings, links,
 * lists, code blocks, paragraphs) and drops everything else. It is not a full
 * HTML parser; malformed pages degrade to plain text.
 *
 * Pages are untrusted and up to 5 MB, so the conversion is a single forward
 * scan with `indexOf`: every search for a closing tag starts where the last
 * one ended, and a missing closing tag ends the scan instead of rescanning.
 * Regular expressions only run on one tag or one text run at a time, so the
 * work grows linearly with the page size.
 *
 * This module has no pi imports so `node --test` can exercise it directly.
 */

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	copy: "©",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
};

const MAX_CODE_POINT = 0x10ffff;

/** Elements whose whole content is dropped. */
const SKIPPED_ELEMENTS = new Set(["script", "style", "noscript", "svg", "iframe", "template", "head", "title", "nav", "footer"]);
const BLOCK_ELEMENTS = new Set([
	"p", "div", "section", "article", "main", "header", "aside", "ul", "ol", "table", "tr", "blockquote", "dl", "dt", "dd", "figure", "form",
]);

/** Code blocks are held aside so whitespace collapsing cannot touch them. */
const codePlaceholder = (index: number): string => `\u0000CODE${index}\u0000`;
const CODE_PLACEHOLDER_PATTERN = /\u0000CODE(\d+)\u0000/g;

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
		if (code[0] === "#") {
			const value = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
			return Number.isFinite(value) && value > 0 && value <= MAX_CODE_POINT ? String.fromCodePoint(value) : entity;
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
	});
}

/** Remove tags from a fragment in one pass; an unterminated tag drops the rest. */
function stripTags(html: string): string {
	let text = "";
	let position = 0;
	while (position < html.length) {
		const open = html.indexOf("<", position);
		if (open < 0) return text + html.slice(position);
		text += html.slice(position, open);
		const close = html.indexOf(">", open);
		if (close < 0) return text;
		position = close + 1;
	}
	return text;
}

/** End of the element whose content starts at `from`: the index after its closing tag's `>`. */
function skipPast(html: string, lower: string, name: string, from: number, end: number): { contentEnd: number; next: number } {
	const close = lower.indexOf(`</${name}`, from);
	if (close < 0 || close >= end) return { contentEnd: end, next: end };
	const gt = html.indexOf(">", close);
	return { contentEnd: close, next: gt < 0 || gt >= end ? end : gt + 1 };
}

export function extractTitle(html: string): string | undefined {
	const lower = html.toLowerCase();
	const start = lower.indexOf("<title");
	if (start < 0) return undefined;
	const openEnd = html.indexOf(">", start);
	if (openEnd < 0) return undefined;
	const { contentEnd } = skipPast(html, lower, "title", openEnd + 1, html.length);
	const title = decodeEntities(stripTags(html.slice(openEnd + 1, contentEnd))).replace(/\s+/g, " ").trim();
	return title || undefined;
}

function tagName(tag: string): string {
	return /^\/?\s*([a-z][a-z0-9-]*)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
}

/** Only the start of a tag is searched, so a huge malformed tag cannot make the regex slow. */
const MAX_TAG_ATTRIBUTE_CHARS = 2048;

function hrefOf(tag: string): string | undefined {
	return /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
		.exec(tag.slice(0, MAX_TAG_ATTRIBUTE_CHARS))
		?.slice(1)
		.find((value) => value !== undefined);
}

function resolveUrl(href: string, baseUrl: string | undefined): string {
	if (!baseUrl) return href;
	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return href;
	}
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
	const lower = html.toLowerCase();
	let position = 0;
	let end = html.length;
	const bodyStart = lower.indexOf("<body");
	if (bodyStart >= 0) {
		const gt = html.indexOf(">", bodyStart);
		position = gt < 0 ? end : gt + 1;
		const bodyEnd = lower.lastIndexOf("</body");
		if (bodyEnd >= position) end = bodyEnd;
	}

	const out: string[] = [];
	const codeBlocks: string[] = [];
	// Text runs with visible characters so far; lets a closing link check for text in constant time.
	let textRuns = 0;
	const pushText = (text: string): void => {
		out.push(decodeEntities(text));
		if (/\S/.test(text)) textRuns++;
	};
	// Open links: where their `[` sits in `out`, their resolved target (undefined drops the link
	// markup), and the text-run count when they opened.
	const openLinks: { index: number; href?: string; textRunsAtOpen: number }[] = [];

	while (position < end) {
		const open = html.indexOf("<", position);
		if (open < 0 || open >= end) {
			pushText(html.slice(position, end));
			break;
		}
		if (open > position) pushText(html.slice(position, open));

		if (html.startsWith("<!--", open)) {
			const close = html.indexOf("-->", open + 4);
			position = close < 0 || close >= end ? end : close + 3;
			continue;
		}
		const gt = html.indexOf(">", open);
		if (gt < 0 || gt >= end) break;
		const tag = html.slice(open + 1, gt);
		const closing = tag.startsWith("/");
		const name = tagName(tag);
		position = gt + 1;

		if (!closing && SKIPPED_ELEMENTS.has(name)) {
			if (!tag.endsWith("/")) position = skipPast(html, lower, name, position, end).next;
			continue;
		}
		if (!closing && name === "pre") {
			const { contentEnd, next } = skipPast(html, lower, "pre", position, end);
			const code = decodeEntities(stripTags(html.slice(position, contentEnd).replace(/<br\s*\/?>/gi, "\n"))).replace(/\n+$/, "");
			codeBlocks.push(code);
			out.push(`\n\n${codePlaceholder(codeBlocks.length - 1)}\n\n`);
			position = next;
			continue;
		}

		if (/^h[1-6]$/.test(name)) {
			out.push(closing ? "\n\n" : `\n\n${"#".repeat(Number(name[1]))} `);
		} else if (name === "a") {
			if (!closing) {
				const href = hrefOf(tag);
				const usable = href && !href.startsWith("#") && !/^javascript:/i.test(href);
				openLinks.push({
					index: out.length,
					href: usable ? resolveUrl(decodeEntities(href), baseUrl) : undefined,
					textRunsAtOpen: textRuns,
				});
				out.push("[");
			} else {
				const link = openLinks.pop();
				if (link?.href && textRuns > link.textRunsAtOpen) out.push(`](${link.href})`);
				else if (link) out[link.index] = "";
			}
		} else if (name === "code") {
			out.push("`");
		} else if (name === "strong" || name === "b") {
			out.push("**");
		} else if (name === "em" || name === "i") {
			out.push("*");
		} else if (name === "li" && !closing) {
			out.push("\n- ");
		} else if (name === "br") {
			out.push("\n");
		} else if (name === "td" || name === "th") {
			out.push(" | ");
		} else if (BLOCK_ELEMENTS.has(name)) {
			out.push("\n\n");
		}
	}
	// Links left open by malformed HTML keep their text but lose the markup.
	for (const link of openLinks) out[link.index] = "";

	return out
		.join("")
		.replace(/[ \t\f\v\r]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.replace(CODE_PLACEHOLDER_PATTERN, (_match, index: string) => `\`\`\`\n${codeBlocks[Number(index)]}\n\`\`\``);
}
