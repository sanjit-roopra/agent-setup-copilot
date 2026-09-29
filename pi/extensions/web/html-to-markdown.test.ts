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

	test("keeps code blocks verbatim", () => {
		assert.equal(htmlToMarkdown(page("<pre><code>npm i -g pi\n  pi --help</code></pre>")), "```\nnpm i -g pi\n  pi --help\n```");
	});

	test("marks inline code, bold, and emphasis", () => {
		assert.equal(htmlToMarkdown(page("<p>Run <code>pi</code>, <b>now</b> <em>please</em></p>")), "Run `pi`, **now** *please*");
	});

	test("drops scripts, styles, and navigation", () => {
		assert.equal(htmlToMarkdown(page("<nav><a href='/'>Home</a></nav><script>alert(1)</script><style>p{}</style>Body")), "Body");
	});

	test("keeps content inside a form", () => {
		assert.equal(htmlToMarkdown(page("<form><p>Whole page</p></form>")), "Whole page");
	});

	test("converts a page without a body tag", () => {
		assert.equal(htmlToMarkdown("<p>Fragment</p>"), "Fragment");
	});

	test("stays fast on malformed input", () => {
		const inputs = {
			"repeated <body>": "<body>".repeat(200_000),
			"unclosed links": '<a href="x">'.repeat(200_000),
			"nested links": `${'<a href="x">y'.repeat(100_000)}${"</a>".repeat(100_000)}`,
			"unclosed scripts": "<script>".repeat(200_000),
			"unterminated tag": `<p>${"<".repeat(1_000_000)}`,
			"unclosed quote in href": `<a ${"href='".repeat(200_000)}>`,
		};
		for (const [name, html] of Object.entries(inputs)) {
			const start = performance.now();
			htmlToMarkdown(html);
			assert.ok(performance.now() - start < 1000, `${name} took ${Math.round(performance.now() - start)} ms`);
		}
	});
});

describe("extractTitle", () => {
	test("returns the decoded, trimmed title", () => {
		assert.equal(extractTitle("<head><title>\n Docs &amp; API </title></head>"), "Docs & API");
	});

	test("returns undefined when there is no title", () => {
		assert.equal(extractTitle("<p>x</p>"), undefined);
	});
});

test("decodeEntities handles named and numeric entities and leaves unknown ones", () => {
	assert.equal(decodeEntities("&lt;a&gt; &#39;x&#39; &#x2192; &AMP; &bogus; &#0;"), "<a> 'x' → & &bogus; &#0;");
});
