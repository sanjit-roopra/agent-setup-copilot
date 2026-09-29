/**
 * Dependency-free HTML to Markdown-ish text conversion for `fleet_web_fetch`.
 *
 * It keeps what a model needs from a documentation page (headings, links,
 * lists, code blocks, paragraphs) and drops everything else. It is not a full
 * HTML parser; malformed pages degrade to plain text.
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

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
		if (code[0] === "#") {
			const value = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
			return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
	});
}

function stripTags(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

export function extractTitle(html: string): string | undefined {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	const title = match ? decodeEntities(stripTags(match[1])).replace(/\s+/g, " ").trim() : "";
	return title || undefined;
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
	let body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

	// Drop content that is never useful to a model.
	body = body
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|noscript|svg|iframe|template|head|nav|footer|form)\b[\s\S]*?<\/\1>/gi, "");

	// Code blocks first so their whitespace survives the collapsing below.
	const codeBlocks: string[] = [];
	body = body.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => {
		codeBlocks.push(decodeEntities(stripTags(inner.replace(/<br\s*\/?>/gi, "\n"))).replace(/\n+$/, ""));
		return `\n\u0000CODE${codeBlocks.length - 1}\u0000\n`;
	});

	body = body
		.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
			return `\n\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n\n`;
		})
		.replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
			const text = stripTags(inner).trim();
			if (!text) return "";
			if (!href || href.startsWith("#") || href.startsWith("javascript:")) return text;
			return `[${text}](${resolveUrl(decodeEntities(href), baseUrl)})`;
		})
		.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${stripTags(inner)}\``)
		.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
		.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/?(p|div|section|article|main|header|aside|ul|ol|table|tr|blockquote|dl|dt|dd|figure)\b[^>]*>/gi, "\n\n")
		.replace(/<\/?(td|th)\b[^>]*>/gi, " | ");

	let text = decodeEntities(stripTags(body))
		.replace(/[ \t\f\v\r]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	text = text.replace(/\u0000CODE(\d+)\u0000/g, (_m, index: string) => `\`\`\`\n${codeBlocks[Number(index)]}\n\`\`\``);
	return text;
}

function resolveUrl(href: string, baseUrl: string | undefined): string {
	if (!baseUrl) return href;
	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return href;
	}
}
