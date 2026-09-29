import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { findGitHubTokens, formatSearchResult, parseRpcBody } from "./github-search.ts";
import { decodeEntities, extractTitle, htmlToMarkdown } from "./html-to-markdown.ts";

test("findGitHubTokens prefers pi's GitHub login, then gh, then env, without duplicates", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-web-test-"));
	const authFile = path.join(dir, "auth.json");
	fs.writeFileSync(authFile, JSON.stringify({ "github-copilot": { refresh: "ghu_pi", access: "tid=short" } }));
	const tokens = await findGitHubTokens(authFile, { GH_TOKEN: "gho_env", GITHUB_TOKEN: "ghu_pi" }, async () => "gho_gh");
	assert.deepEqual(
		tokens.map((t) => t.token),
		["ghu_pi", "gho_gh", "gho_env"],
	);
	fs.rmSync(dir, { recursive: true });
});

test("findGitHubTokens tolerates a missing auth file and gh", async () => {
	const tokens = await findGitHubTokens("/nonexistent/auth.json", {}, async () => undefined);
	assert.deepEqual(tokens, []);
});

test("parseRpcBody reads SSE and plain JSON", () => {
	assert.deepEqual(parseRpcBody('event: message\ndata: {"id":1,"result":{"ok":true}}\n\n').result, { ok: true });
	assert.deepEqual(parseRpcBody('{"id":1,"result":{"ok":true}}').result, { ok: true });
});

test("formatSearchResult strips citation markers and lists unique sources", () => {
	const payload = {
		type: "output_text",
		text: {
			value: "Version 1.2 is latest【3:0†source】【3:1†source】.",
			annotations: [
				{ url_citation: { title: "npm", url: "https://npmjs.com/x" } },
				{ url_citation: { title: "npm again", url: "https://npmjs.com/x" } },
				{ url_citation: { title: "GitHub", url: "https://github.com/x" } },
			],
		},
	};
	const text = formatSearchResult({ content: [{ type: "text", text: JSON.stringify(payload) }] });
	assert.equal(text, "Version 1.2 is latest.\n\nSources:\n- npm: https://npmjs.com/x\n- GitHub: https://github.com/x");
});

test("formatSearchResult surfaces tool errors", () => {
	assert.throws(() => formatSearchResult({ isError: true, content: [{ type: "text", text: "quota" }] }), /quota/);
});

test("htmlToMarkdown keeps headings, links, lists, and code; drops scripts and nav", () => {
	const html = `<html><head><title>Docs &amp; API</title></head><body>
		<nav><a href="/home">Home</a></nav>
		<script>alert(1)</script>
		<h1>Install</h1>
		<p>Run the <code>pi</code> command. See <a href="/guide">the guide</a>.</p>
		<ul><li>One</li><li>Two</li></ul>
		<pre><code>npm i -g pi
pi --help</code></pre>
	</body></html>`;
	const md = htmlToMarkdown(html, "https://example.com/docs/");
	assert.equal(extractTitle(html), "Docs & API");
	assert.match(md, /^# Install/m);
	assert.match(md, /Run the `pi` command\. See \[the guide\]\(https:\/\/example\.com\/guide\)\./);
	assert.match(md, /^- One$/m);
	assert.match(md, /```\nnpm i -g pi\npi --help\n```/);
	assert.doesNotMatch(md, /alert|Home/);
});

test("decodeEntities handles named and numeric entities", () => {
	assert.equal(decodeEntities("&lt;a&gt; &#39;x&#39; &#x2192; &bogus;"), "<a> 'x' → &bogus;");
});
