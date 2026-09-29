/**
 * Web search through GitHub's hosted MCP server, the same backend Copilot CLI
 * uses for its `web_search` tool.
 *
 * The `web_search` toolset is not in GitHub's public MCP documentation; it was
 * found in the Copilot CLI package, which requests it with the
 * `X-MCP-Toolsets` header. If GitHub changes it, this tool stops working and
 * reports the HTTP error.
 *
 * This module has no pi imports so `node --test` can exercise it directly.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";

export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export interface TokenCandidate {
	source: string;
	token: string;
}

/**
 * GitHub tokens to try, in order: pi's GitHub Copilot login, the GitHub CLI,
 * then `GH_TOKEN` / `GITHUB_TOKEN`. pi stores its GitHub OAuth token in the
 * `refresh` field; the short-lived Copilot token in `access` is not accepted
 * by the MCP endpoint.
 */
export async function findGitHubTokens(
	authFile: string,
	env: Record<string, string | undefined> = process.env,
	ghToken: () => Promise<string | undefined> = readGhToken,
): Promise<TokenCandidate[]> {
	const candidates: TokenCandidate[] = [];
	try {
		const auth = JSON.parse(fs.readFileSync(authFile, "utf-8")) as Record<string, { refresh?: unknown }>;
		const refresh = auth["github-copilot"]?.refresh;
		if (typeof refresh === "string" && refresh) candidates.push({ source: "pi GitHub Copilot login", token: refresh });
	} catch {
		// No pi login yet; fall through to the other sources.
	}
	const gh = await ghToken();
	if (gh) candidates.push({ source: "gh auth token", token: gh });
	for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) {
		const value = env[name]?.trim();
		if (value) candidates.push({ source: name, token: value });
	}
	const seen = new Set<string>();
	return candidates.filter((c) => !seen.has(c.token) && seen.add(c.token));
}

function readGhToken(): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile("gh", ["auth", "token"], { timeout: 5000, windowsHide: true }, (error, stdout) => {
			resolve(error ? undefined : stdout.trim() || undefined);
		});
	});
}

export class HttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Parse a JSON-RPC response that may arrive as plain JSON or as SSE `data:` lines. */
export function parseRpcBody(body: string): { result?: any; error?: { message?: string } } {
	const trimmed = body.trim();
	if (trimmed.startsWith("{")) return JSON.parse(trimmed);
	const dataLines = trimmed
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim());
	if (dataLines.length === 0) throw new Error(`Unexpected response: ${trimmed.slice(0, 200)}`);
	return JSON.parse(dataLines[dataLines.length - 1]);
}

/**
 * Turn the tool result into text for the model: the answer without the
 * `【3:0†source】` markers, followed by a deduplicated source list.
 */
export function formatSearchResult(result: any): string {
	const text = (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => String(c.text))
		.join("\n");
	if (result?.isError) throw new Error(text || "web_search returned an error");

	let payload: any;
	try {
		payload = JSON.parse(text);
	} catch {
		return text;
	}
	const answer = String(payload?.text?.value ?? text)
		.replace(/【[^】]*】/g, "")
		.trim();
	const sources = new Map<string, string>();
	for (const annotation of payload?.text?.annotations ?? []) {
		const url = annotation?.url_citation?.url;
		if (typeof url === "string" && !sources.has(url)) sources.set(url, String(annotation.url_citation.title ?? url));
	}
	if (sources.size === 0) return answer;
	const list = [...sources].map(([url, title]) => `- ${title}: ${url}`).join("\n");
	return `${answer}\n\nSources:\n${list}`;
}

export async function callWebSearch(query: string, token: string, signal?: AbortSignal): Promise<string> {
	const response = await fetch(GITHUB_MCP_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"X-MCP-Toolsets": "web_search",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "web_search", arguments: { query } },
		}),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
	});
	const body = await response.text();
	if (!response.ok) throw new HttpError(response.status, `HTTP ${response.status}: ${body.slice(0, 300)}`);
	const rpc = parseRpcBody(body);
	if (rpc.error) throw new Error(`MCP error: ${rpc.error.message ?? JSON.stringify(rpc.error)}`);
	return formatSearchResult(rpc.result);
}
