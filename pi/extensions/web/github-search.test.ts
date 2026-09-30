import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test, type TestContext } from "node:test";
import {
	callWebSearch,
	findGitHubTokens,
	GITHUB_MCP_URL,
	HttpError,
	isLoginRejected,
	parseRpcBody,
	readGhCliToken,
	searchResultToText,
	searchWithFallback,
	type TokenCandidate,
} from "./github-search.ts";

/** Writes an auth.json shaped like pi 0.87.1's: `{ "github-copilot": { refresh, access, ... } }`. */
function writeAuthFile(t: TestContext, content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-search-test-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const authFile = path.join(dir, "auth.json");
	fs.writeFileSync(authFile, content);
	return authFile;
}

// double-waiver: B1 — the real readGhCliToken spawns the `gh` subprocess.
const noGhToken = async (): Promise<string | undefined> => undefined;

describe("findGitHubTokens", () => {
	test("orders pi's login, then gh, then GH_TOKEN, then GITHUB_TOKEN", async (t) => {
		const authFile = writeAuthFile(t, JSON.stringify({ "github-copilot": { refresh: "ghu_pi", access: "tid=short" } }));
		// double-waiver: B1 — the real readGhCliToken spawns the `gh` subprocess.
		const tokens = await findGitHubTokens(authFile, { GH_TOKEN: "gho_env", GITHUB_TOKEN: "ghp_env2" }, async () => "gho_gh");
		assert.deepEqual(
			tokens.map((c) => c.token),
			["ghu_pi", "gho_gh", "gho_env", "ghp_env2"],
		);
	});

	test("drops a token already found in an earlier source", async (t) => {
		const authFile = writeAuthFile(t, JSON.stringify({ "github-copilot": { refresh: "ghu_pi" } }));
		const tokens = await findGitHubTokens(authFile, { GITHUB_TOKEN: "ghu_pi" }, noGhToken);
		assert.deepEqual(
			tokens.map((c) => c.source),
			["pi GitHub Copilot login"],
		);
	});

	test("never uses pi's short-lived access token", async (t) => {
		const authFile = writeAuthFile(t, JSON.stringify({ "github-copilot": { access: "tid=short" } }));
		assert.deepEqual(await findGitHubTokens(authFile, {}, noGhToken), []);
	});

	test("tolerates a missing auth file", async () => {
		assert.deepEqual(await findGitHubTokens("/nonexistent/auth.json", {}, noGhToken), []);
	});

	test("tolerates a malformed auth file", async (t) => {
		assert.deepEqual(await findGitHubTokens(writeAuthFile(t, "{not json"), {}, noGhToken), []);
	});

	test("ignores a refresh value that is not a string", async (t) => {
		const authFile = writeAuthFile(t, JSON.stringify({ "github-copilot": { refresh: 42 } }));
		assert.deepEqual(await findGitHubTokens(authFile, {}, noGhToken), []);
	});

	test("ignores blank environment values", async () => {
		assert.deepEqual(await findGitHubTokens("/nonexistent/auth.json", { GH_TOKEN: "  " }, noGhToken), []);
	});
});

describe("readGhCliToken", () => {
	type Call = { file: string; args: string[] };
	// double-waiver: B1 — stands in for execFile, which would spawn the real `gh`.
	const runFile =
		(calls: Call[], error: Error | null, stdout: string) =>
		(file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
			calls.push({ file, args });
			callback(error, stdout);
		};

	test("asks gh for the github.com token only", async () => {
		const calls: Call[] = [];
		assert.equal(await readGhCliToken(runFile(calls, null, "gho_x\n")), "gho_x");
		assert.deepEqual(calls, [{ file: "gh", args: ["auth", "token", "--hostname", "github.com"] }]);
	});

	test("returns undefined when gh fails or prints nothing", async () => {
		assert.equal(await readGhCliToken(runFile([], new Error("not logged in"), "")), undefined);
		assert.equal(await readGhCliToken(runFile([], null, "  \n")), undefined);
	});
});

describe("parseRpcBody", () => {
	test("reads plain JSON", () => {
		assert.deepEqual(parseRpcBody('{"id":1,"result":{"ok":true}}').result, { ok: true });
	});

	test("reads a single SSE event", () => {
		assert.deepEqual(parseRpcBody('event: message\ndata: {"id":1,"result":{"ok":true}}\n\n').result, { ok: true });
	});

	test("joins an event's data lines", () => {
		assert.deepEqual(parseRpcBody('event: message\ndata: {"id":1,\ndata: "result":{"ok":true}}\n\n').result, { ok: true });
	});

	test("reads CRLF line endings and data lines without a space", () => {
		assert.deepEqual(parseRpcBody('event: message\r\ndata:{"result":{"ok":true}}\r\n\r\n').result, { ok: true });
	});

	test("uses the last event", () => {
		const body = 'data: {"result":{"n":1}}\n\ndata: {"result":{"n":2}}\n\n';
		assert.deepEqual(parseRpcBody(body).result, { n: 2 });
	});

	test("rejects a body with no data", () => {
		assert.throws(() => parseRpcBody("event: ping\n\n"), /Unexpected response/);
	});
});

describe("searchResultToText", () => {
	const result = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

	test("strips citation markers and lists each source once", () => {
		const text = searchResultToText(
			result({
				type: "output_text",
				text: {
					value: "Version 1.2 is latest【3:0†source】【3:1†source】.",
					annotations: [
						{ url_citation: { title: "npm", url: "https://npmjs.com/x" } },
						{ url_citation: { title: "npm again", url: "https://npmjs.com/x" } },
						{ url_citation: { title: "GitHub", url: "https://github.com/x" } },
					],
				},
			}),
		);
		assert.equal(text, "Version 1.2 is latest.\n\nSources:\n- npm: https://npmjs.com/x\n- GitHub: https://github.com/x");
	});

	test("returns the answer alone when there are no sources", () => {
		assert.equal(searchResultToText(result({ text: { value: "Answer", annotations: [] } })), "Answer");
	});

	test("uses the URL when a source has no title", () => {
		const text = searchResultToText(result({ text: { value: "A", annotations: [{ url_citation: { url: "https://x.dev" } }] } }));
		assert.equal(text, "A\n\nSources:\n- https://x.dev: https://x.dev");
	});

	test("returns non-JSON text unchanged", () => {
		assert.equal(searchResultToText({ content: [{ type: "text", text: "plain answer" }] }), "plain answer");
	});
});

describe("callWebSearch", () => {
	function fakeFetch(status: number, body: string, calls: { url: string; init: RequestInit }[] = []): typeof fetch {
		return (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(body, { status });
		}) as unknown as typeof fetch;
	}

	test("sends the query to GitHub's MCP endpoint with the web_search toolset and no redirects", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const body = `data: ${JSON.stringify({ result: { content: [{ type: "text", text: "plain" }] } })}\n\n`;
		assert.equal(await callWebSearch("q?", "tok", undefined, fakeFetch(200, body, calls)), "plain");

		const [{ url, init }] = calls;
		const headers = init.headers as Record<string, string>;
		assert.deepEqual(
			{
				url,
				authorization: headers.Authorization,
				toolsets: headers["X-MCP-Toolsets"],
				redirect: init.redirect,
				params: JSON.parse(String(init.body)).params,
			},
			{
				url: GITHUB_MCP_URL,
				authorization: "Bearer tok",
				toolsets: "web_search",
				redirect: "error",
				params: { name: "web_search", arguments: { query: "q?" } },
			},
		);
	});

	test("raises an HttpError with the status for a rejected token", async () => {
		await assert.rejects(callWebSearch("q", "bad", undefined, fakeFetch(401, "no")), (error: unknown) => {
			assert.ok(error instanceof HttpError);
			assert.equal(error.status, 401);
			return true;
		});
	});

	test("raises a JSON-RPC error", async () => {
		await assert.rejects(callWebSearch("q", "t", undefined, fakeFetch(200, '{"error":{"message":"boom"}}')), /MCP error: boom/);
	});

	test("raises an error when the search returns no content", async () => {
		await assert.rejects(callWebSearch("q", "t", undefined, fakeFetch(200, '{"result":{"content":[]}}')), /returned no content/);
	});

	test("raises a tool error with its text", async () => {
		const body = JSON.stringify({ result: { isError: true, content: [{ type: "text", text: "quota exceeded" }] } });
		await assert.rejects(callWebSearch("q", "t", undefined, fakeFetch(200, body)), /quota exceeded/);
	});
});

describe("searchWithFallback", () => {
	const candidates: TokenCandidate[] = [
		{ source: "first", token: "a" },
		{ source: "second", token: "b" },
	];

	test("moves to the next login when the token is rejected with 400, 401, or 403", async () => {
		for (const status of [400, 401, 403]) {
			const result = await searchWithFallback("q", candidates, undefined, async (_query, token) => {
				if (token === "a") throw new HttpError(status, `HTTP ${status}`);
				return "ok";
			});
			assert.deepEqual(result, { text: "ok", tokenSource: "second" }, `status ${status}`);
		}
	});

	test("stops at an error that is not a token rejection", async () => {
		const tried: string[] = [];
		await assert.rejects(
			searchWithFallback("q", candidates, undefined, async (_query, token) => {
				tried.push(token);
				throw new HttpError(500, "HTTP 500");
			}),
			/HTTP 500/,
		);
		assert.deepEqual(tried, ["a"]);
	});

	test("reports every rejected login", async () => {
		await assert.rejects(
			searchWithFallback("q", candidates, undefined, async () => {
				throw new HttpError(401, "HTTP 401");
			}),
			/Every GitHub login was rejected:\nfirst: HTTP 401\nsecond: HTTP 401/,
		);
	});

	test("explains how to log in when there is no token", async () => {
		await assert.rejects(searchWithFallback("q", [], undefined, async () => "unused"), /Run \/login in pi/);
	});
});

test("isLoginRejected accepts only token-rejection statuses", () => {
	assert.equal(isLoginRejected(new HttpError(401, "")), true);
	assert.equal(isLoginRejected(new HttpError(429, "")), false);
	assert.equal(isLoginRejected(new Error("network")), false);
});
