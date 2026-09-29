import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeEntities, extractTitle, htmlToMarkdown } from "./html-to-markdown.ts";

const page = (body: string) => `<html><head><title>T</title></head><body>${body}</body></html>`;

describe("htmlToMarkdown", () => {
	test("turns headings into Markdown headings", () => {
		assert.equal(htmlToMarkdown(page("<h1>Install</h1><h3>Step</h3>")), "# Install\n\n### Step");
	});

	test("resolves relative links against the page URL", () => {
		assert.equal(
			htmlToMarkdown(page('See <a href="/guide">the guide</a>.'), "https://example.com/docs/"),
			"See [the guide](https://example.com/guide).",
		);
	});

	test("reads single-quoted and unquoted href values and decodes entities in them", () => {
		assert.equal(
			htmlToMarkdown(page("<a href='/a?x=1&amp;y=2'>A</a> <a href=/b>B</a>"), "https://e.dev/"),
			"[A](https://e.dev/a?x=1&y=2) [B](https://e.dev/b)",
		);
	});

	test("ignores data-href and uses the real href", () => {
		assert.equal(htmlToMarkdown(page('<a data-href="/x" href="/y">L</a>'), "https://e.dev/"), "[L](https://e.dev/y)");
	});

	test("keeps only the text of anchor and javascript links", () => {
		assert.equal(htmlToMarkdown(page('<a href="#top">Top</a> <a href="javascript:x()">Run</a>')), "Top Run");
	});

	test("drops links with no text", () => {
		assert.equal(htmlToMarkdown(page('a<a href="/x"><img src="i.png"></a>b')), "ab");
	});

	test("turns list items into bullets", () => {
		assert.equal(htmlToMarkdown(page("<ul><li>One</li><li>Two</li></ul>")), "- One\n- Two");
	});

	test("does not treat <link> as a list item", () => {
		assert.equal(htmlToMarkdown(page('<link rel="preload" href="/a.js">Text')), "Text");
	});

	test("keeps code blocks verbatim, including <br> line breaks", () => {
		assert.equal(
			htmlToMarkdown(page("<pre><code>npm i -g pi<br>  pi --help &lt;x&gt;</code></pre>")),
			"```\nnpm i -g pi\n  pi --help <x>\n```",
		);
	});

	test("marks inline code, bold, and emphasis", () => {
		assert.equal(htmlToMarkdown(page("<p>Run <code>pi</code>, <b>now</b> <em>please</em></p>")), "Run `pi`, **now** *please*");
	});

	test("turns <br> into a line break and table cells into columns", () => {
		assert.equal(htmlToMarkdown(page("a<br>b<table><tr><td>1</td><td>2</td></tr></table>")), "a\nb\n\n| 1 | | 2 |");
	});

	test("drops scripts, styles, navigation, and comments", () => {
		assert.equal(
			htmlToMarkdown(page("<nav><a href='/'>Home</a></nav><script>alert(1)</script><style>p{}</style><!-- note -->Body")),
			"Body",
		);
	});

	test("drops a nested navigation block completely", () => {
		assert.equal(htmlToMarkdown(page("<nav><nav>inner</nav>outer</nav>Body")), "Body");
	});

	test("drops a self-closing svg without swallowing the rest", () => {
		assert.equal(htmlToMarkdown(page('<svg viewBox="0 0 1 1"/>Body')), "Body");
	});

	test("drops everything after an unterminated comment", () => {
		assert.equal(htmlToMarkdown(page("Before<!-- never closed <p>After")), "Before");
	});

	test("keeps content inside a form", () => {
		assert.equal(htmlToMarkdown(page("<form><p>Whole page</p></form>")), "Whole page");
	});

	test("treats a < that does not start a tag as text", () => {
		assert.equal(htmlToMarkdown(page("<p>if a < b then c</p><p>x<1</p>")), "if a < b then c\n\nx<1");
	});

	test("keeps positions right after characters whose lowercase is longer", () => {
		assert.equal(htmlToMarkdown(page("<p>İİİİ</p><script>x</script><p>After</p>")), "İİİİ\n\nAfter");
	});

	test("converts a page without a body tag", () => {
		assert.equal(htmlToMarkdown("<p>Fragment</p>"), "Fragment");
	});
});

describe("htmlToMarkdown on malformed input stays fast", () => {
	// A generous limit: the scan is linear, so these take milliseconds; quadratic behaviour would take minutes.
	const LIMIT_MS = 2000;
	const inputs: Record<string, string> = {
		"repeated <body>": "<body>".repeat(200_000),
		"unclosed links": '<a href="x">'.repeat(200_000),
		"nested links": `${'<a href="x">y'.repeat(100_000)}${"</a>".repeat(100_000)}`,
		"unclosed scripts": "<script>".repeat(200_000),
		"nested navigation": `${"<nav>".repeat(100_000)}${"</nav>".repeat(100_000)}`,
		"unterminated tag": `<p>${"<".repeat(1_000_000)}`,
		"unclosed quote in href": `<a ${"href='".repeat(200_000)}>`,
	};
	for (const [name, html] of Object.entries(inputs)) {
		test(name, () => {
			const start = performance.now();
			htmlToMarkdown(html);
			const elapsed = performance.now() - start;
			assert.ok(elapsed < LIMIT_MS, `${name} took ${Math.round(elapsed)} ms`);
		});
	}
});

describe("extractTitle", () => {
	test("returns the decoded, trimmed title", () => {
		assert.equal(extractTitle("<head><title>\n Docs &amp; API </title></head>"), "Docs & API");
	});

	test("returns undefined when there is no title", () => {
		assert.equal(extractTitle("<p>x</p>"), undefined);
	});
});

describe("decodeEntities", () => {
	const cases: [string, string][] = [
		["&lt;a&gt;", "<a>"],
		["&AMP;", "&"],
		["&#39;", "'"],
		["&#x2192;", "→"],
		["&bogus;", "&bogus;"],
		["&#0;", "&#0;"],
		["&#x110000;", "&#x110000;"],
	];
	for (const [input, expected] of cases) {
		test(`${input} -> ${expected}`, () => {
			assert.equal(decodeEntities(input), expected);
		});
	}
});
