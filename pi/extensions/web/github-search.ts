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
const GITHUB_HOST = "github.com";
const GH_TOKEN_TIMEOUT_MS = 5_000;
const SEARCH_TIMEOUT_MS = 90_000;
const ERROR_SNIPPET_CHARS = 300;
const SSE_DATA_PREFIX = "data:";
const MCP_TOOL = "web_search";
const PI_AUTH_PROVIDER = "github-copilot";
const TOKEN_ENV_VARS = ["GH_TOKEN", "GITHUB_TOKEN"];
/**
 * Statuses that mean the endpoint rejected the token itself. Probed on
 * 2026-09-29 against GITHUB_MCP_URL: an unusable token (pi's short-lived
 * Copilot token) got 400 "Authorization header is badly formatted".
 */
const LOGIN_REJECTED_STATUSES = [400, 401, 403];

export interface TokenCandidate {
	source: string;
	token: string;
}

/**
 * GitHub tokens to try, in order: pi's GitHub Copilot login, the GitHub CLI,
 * then `GH_TOKEN` / `GITHUB_TOKEN`.
 *
 * pi keeps its GitHub OAuth token in `auth.json` under
 * `github-copilot.refresh` (pi 0.87.1, observed 2026-09-29; the token has the
 * `ghu_` prefix). The short-lived Copilot token in `access` is rejected by the
 * MCP endpoint with 400. This is pi's internal storage format, so it is read
 * here and nowhere else.
 */
export async function findGitHubTokens(
	authFile: string,
	env: Record<string, string | undefined> = process.env,
	readGhCliTokenFn: () => Promise<string | undefined> = readGhCliToken,
): Promise<TokenCandidate[]> {
	const candidates: TokenCandidate[] = [];
	try {
		const auth = JSON.parse(fs.readFileSync(authFile, "utf-8")) as Record<string, { refresh?: unknown }>;
		const refresh = auth[PI_AUTH_PROVIDER]?.refresh;
		if (typeof refresh === "string" && refresh) candidates.push({ source: "pi GitHub Copilot login", token: refresh });
	} catch {
		// No pi login yet; fall through to the other sources.
	}
	const ghCliToken = await readGhCliTokenFn();
	if (ghCliToken) candidates.push({ source: "gh auth token", token: ghCliToken });
	for (const envVar of TOKEN_ENV_VARS) {
		const value = env[envVar]?.trim();
		if (value) candidates.push({ source: envVar, token: value });
	}
	return uniqueByToken(candidates);
}

function uniqueByToken(candidates: TokenCandidate[]): TokenCandidate[] {
	const unique: TokenCandidate[] = [];
	for (const candidate of candidates) {
		if (!unique.some((existing) => existing.token === candidate.token)) unique.push(candidate);
	}
	return unique;
}

type RunFile = (
	file: string,
	args: string[],
	options: { timeout: number; windowsHide: boolean },
	callback: (error: Error | null, stdout: string) => void,
) => void;

/** The github.com token only; a GitHub Enterprise default host must not be sent to api.githubcopilot.com. */
export function readGhCliToken(runFile: RunFile = execFile as unknown as RunFile): Promise<string | undefined> {
	return new Promise((resolve) => {
		runFile(
			"gh",
			["auth", "token", "--hostname", GITHUB_HOST],
			{ timeout: GH_TOKEN_TIMEOUT_MS, windowsHide: true },
			(error, stdout) => resolve(error ? undefined : String(stdout).trim() || undefined),
		);
	});
}

export class HttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Whether the endpoint rejected the token itself, so the next login is worth trying. */
export function isLoginRejected(error: unknown): boolean {
	return error instanceof HttpError && LOGIN_REJECTED_STATUSES.includes(error.status);
}

/**
 * Parse a JSON-RPC response that arrives as plain JSON or as SSE. For SSE, the
 * `data:` lines of each event are joined, and the last event is used.
 */
export function parseRpcBody(body: string): { result?: any; error?: { message?: string } } {
	const trimmed = body.trim();
	if (trimmed.startsWith("{")) return JSON.parse(trimmed);
	const events = trimmed
		.split(/\r?\n\r?\n/)
		.map((event) =>
			event
				.split(/\r?\n/)
				.filter((line) => line.startsWith(SSE_DATA_PREFIX))
				.map((line) => line.slice(SSE_DATA_PREFIX.length).replace(/^ /, ""))
				.join("\n"),
		)
		.filter((data) => data !== "");
	if (events.length === 0) throw new Error(`Unexpected response: ${trimmed.slice(0, ERROR_SNIPPET_CHARS)}`);
	return JSON.parse(events[events.length - 1]);
}

function resultText(result: any): string {
	return (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => String(c.text))
		.join("\n");
}

/**
 * Turn a successful tool result into text for the model: the answer without
 * the `【3:0†source】` markers, followed by a deduplicated source list.
 */
export function searchResultToText(result: any): string {
	const text = resultText(result);
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

export async function callWebSearch(
	query: string,
	token: string,
	signal?: AbortSignal,
	fetchImpl: typeof fetch = fetch,
): Promise<string> {
	const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	const response = await fetchImpl(GITHUB_MCP_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"X-MCP-Toolsets": MCP_TOOL,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: MCP_TOOL, arguments: { query } },
		}),
		// The token goes to this one URL only; never follow a redirect with it.
		redirect: "error",
		signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
	});
	const body = await response.text();
	if (!response.ok) {
		throw new HttpError(response.status, `HTTP ${response.status}: ${body.slice(0, ERROR_SNIPPET_CHARS)}`);
	}
	const rpc = parseRpcBody(body);
	if (rpc.error) throw new Error(`MCP error: ${rpc.error.message ?? JSON.stringify(rpc.error)}`);
	if (rpc.result?.isError) throw new Error(resultText(rpc.result) || `${MCP_TOOL} returned an error`);
	const text = searchResultToText(rpc.result);
	if (!text.trim()) throw new Error(`${MCP_TOOL} returned no content`);
	return text;
}

type SearchFn = (query: string, token: string, signal?: AbortSignal) => Promise<string>;

/** Try each login in order, moving on only when the endpoint rejected the token. */
export async function searchWithFallback(
	query: string,
	candidates: TokenCandidate[],
	signal?: AbortSignal,
	search: SearchFn = callWebSearch,
): Promise<{ text: string; tokenSource: string }> {
	if (candidates.length === 0) {
		throw new Error("No GitHub login found. Run /login in pi and choose GitHub Copilot, or run `gh auth login`.");
	}
	const failures: string[] = [];
	for (const candidate of candidates) {
		try {
			return { text: await search(query, candidate.token, signal), tokenSource: candidate.source };
		} catch (error) {
			if (!isLoginRejected(error)) throw error;
			failures.push(`${candidate.source}: ${(error as Error).message}`);
		}
	}
	throw new Error(`Every GitHub login was rejected:\n${failures.join("\n")}`);
}
