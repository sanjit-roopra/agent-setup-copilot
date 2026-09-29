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
/** Skipped elements whose content is raw text, so a nested opening tag inside them is not a real element. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "noscript", "iframe", "title"]);
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

/**
 * Lowercase ASCII letters only. Unlike `toLowerCase`, this never changes the
 * string's length (`İ` lowercases to two characters), so indexes found in the
 * lowered copy stay valid in the original.
 */
function lowerAscii(text: string): string {
	return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/**
 * Find the end of the element whose content starts at `from`: where its content
 * ends and the index after its closing tag's `>`. Nested elements of the same
 * name are counted, except self-closing ones and inside raw-text elements. If
 * the nesting never balances (for example a tag inside a comment), the first
 * closing tag ends the element instead of the rest of the page being dropped.
 * Each search resumes where the previous one stopped, so the scan stays linear.
 */
function findElementEnd(html: string, lower: string, name: string, from: number, end: number): { contentEnd: number; next: number } {
	const openTag = `<${name}`;
	const closeTag = `</${name}`;
	let depth = 1;
	// The next opening and closing tag; each is searched for again only after it has been consumed.
	let nextOpen = RAW_TEXT_ELEMENTS.has(name) ? -1 : lower.indexOf(openTag, from);
	let nextClose = lower.indexOf(closeTag, from);
	const firstClose = nextClose;
	// The `>` after the latest nested opening tag; reused while later opening tags come before it.
	let openTagEnd = -1;
	const elementEndingAt = (close: number) => {
		const tagEnd = html.indexOf(">", close);
		return { contentEnd: close, next: tagEnd < 0 || tagEnd >= end ? end : tagEnd + 1 };
	};
	for (;;) {
		if (nextClose < 0 || nextClose >= end) {
			return firstClose >= 0 && firstClose < end ? elementEndingAt(firstClose) : { contentEnd: end, next: end };
		}
		if (nextOpen >= 0 && nextOpen < nextClose) {
			if (openTagEnd < nextOpen) openTagEnd = html.indexOf(">", nextOpen);
			if (openTagEnd < 0) openTagEnd = end;
			if (html[openTagEnd - 1] !== "/") depth++;
			nextOpen = lower.indexOf(openTag, nextOpen + 1);
			continue;
		}
		if (--depth === 0) return elementEndingAt(nextClose);
		nextClose = lower.indexOf(closeTag, nextClose + 1);
	}
}

export function extractTitle(html: string): string | undefined {
	const lower = lowerAscii(html);
	const start = lower.indexOf("<title");
	if (start < 0) return undefined;
	const openEnd = html.indexOf(">", start);
	if (openEnd < 0) return undefined;
	const { contentEnd } = findElementEnd(html, lower, "title", openEnd + 1, html.length);
	const title = decodeEntities(stripTags(html.slice(openEnd + 1, contentEnd))).replace(/\s+/g, " ").trim();
	return title || undefined;
}

function tagName(tag: string): string {
	return /^\/?([a-z][a-z0-9-]*)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
}

/** A `<` starts markup only when a letter, `/`, `!`, or `?` follows; otherwise it is text, as in `a < b`. */
function startsMarkup(html: string, open: number): boolean {
	return /[a-z/!?]/i.test(html[open + 1] ?? "");
}

/** Only the start of a tag is searched, so a huge malformed tag cannot make the regex slow. */
const MAX_TAG_ATTRIBUTE_CHARS = 2048;

function hrefOf(tag: string): string | undefined {
	return /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
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
	const lower = lowerAscii(html);
	let position = 0;
	let end = html.length;
	const bodyStart = lower.indexOf("<body");
	if (bodyStart >= 0) {
		const bodyTagEnd = html.indexOf(">", bodyStart);
		position = bodyTagEnd < 0 ? end : bodyTagEnd + 1;
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
		if (!startsMarkup(html, open)) {
			pushText(html.slice(position, open + 1));
			position = open + 1;
			continue;
		}
		if (open > position) pushText(html.slice(position, open));

		if (html.startsWith("<!--", open)) {
			const close = html.indexOf("-->", open + 4);
			position = close < 0 || close >= end ? end : close + 3;
			continue;
		}
		const tagEnd = html.indexOf(">", open);
		if (tagEnd < 0 || tagEnd >= end) break;
		const tag = html.slice(open + 1, tagEnd);
		const closing = tag.startsWith("/");
		const name = tagName(tag);
		position = tagEnd + 1;

		if (!closing && SKIPPED_ELEMENTS.has(name)) {
			if (!tag.endsWith("/")) position = findElementEnd(html, lower, name, position, end).next;
			continue;
		}
		if (!closing && name === "pre") {
			const { contentEnd, next } = findElementEnd(html, lower, "pre", position, end);
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
