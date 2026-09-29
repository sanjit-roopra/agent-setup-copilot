/**
 * Web tools for the fleet: `fleet_web_search` and `fleet_web_fetch`.
 *
 * - Search goes through GitHub's hosted MCP server with the user's existing
 *   GitHub login, so it needs no API key and no MCP configuration.
 * - Fetch runs locally: a plain HTTP GET converted to Markdown-ish text.
 *
 * The tool names are prefixed so they can coexist with other web packages
 * such as pi-web-access, which registers `web_search` and `web_fetch`.
 */

import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { callWebSearch, findGitHubTokens, HttpError } from "./github-search.ts";
import { extractTitle, htmlToMarkdown } from "./html-to-markdown.ts";

const DEFAULT_MAX_CHARS = 50_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

const webSearchTool = defineTool({
	name: "fleet_web_search",
	label: "Web Search",
	description:
		"Search the web and get an answer with cited source URLs. Ask one specific natural-language question per call. Use fleet_web_fetch to read a cited page in full.",
	parameters: Type.Object({
		query: Type.String({ description: "One specific question, e.g. 'What changed in React 19.2?'" }),
	}),

	async execute(_toolCallId, params, signal) {
		const candidates = await findGitHubTokens(path.join(getAgentDir(), "auth.json"));
		if (candidates.length === 0) {
			throw new Error(
				"No GitHub login found. Run /login in pi and choose GitHub Copilot, or run `gh auth login`.",
			);
		}
		const failures: string[] = [];
		for (const candidate of candidates) {
			try {
				const text = await callWebSearch(params.query, candidate.token, signal);
				return { content: [{ type: "text", text }], details: { tokenSource: candidate.source } };
			} catch (error) {
				// Try the next login only when this one was rejected.
				if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
					failures.push(`${candidate.source}: ${error.message}`);
					continue;
				}
				throw error;
			}
		}
		throw new Error(`Every GitHub login was rejected:\n${failures.join("\n")}`);
	},
});

const webFetchTool = defineTool({
	name: "fleet_web_fetch",
	label: "Web Fetch",
	description: "Fetch a public http(s) URL and return its content as Markdown text (HTML) or raw text (other types).",
	parameters: Type.Object({
		url: Type.String({ description: "The http or https URL to fetch" }),
		maxChars: Type.Optional(
			Type.Number({ minimum: 1000, description: `Maximum characters to return (default ${DEFAULT_MAX_CHARS})` }),
		),
	}),

	async execute(_toolCallId, params, signal) {
		const url = new URL(params.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https URLs are supported.");

		const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
		const response = await fetch(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; pi-fleet-web-fetch)",
				Accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5",
			},
			redirect: "follow",
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		if (response.headers.get("cf-mitigated") === "challenge") {
			throw new Error(
				`${url.host} blocks automated requests (Cloudflare challenge). Use fleet_web_search or another source, such as the site's API.`,
			);
		}
		if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);

		const contentType = response.headers.get("content-type") ?? "";
		if (/^(image|audio|video)\/|application\/(octet-stream|zip|pdf)/i.test(contentType)) {
			throw new Error(`Unsupported content type: ${contentType}`);
		}
		const raw = await readLimited(response, MAX_DOWNLOAD_BYTES);
		const isHtml = /html/i.test(contentType) || /^\s*<(!doctype html|html)/i.test(raw);
		const title = isHtml ? extractTitle(raw) : undefined;
		let text = isHtml ? htmlToMarkdown(raw, response.url) : raw;

		const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
		const totalChars = text.length;
		if (totalChars > maxChars) {
			text = `${text.slice(0, maxChars)}\n\n[Truncated: showing ${maxChars} of ${totalChars} characters. Call again with a larger maxChars to see more.]`;
		}
		const header = `URL: ${response.url}${title ? `\nTitle: ${title}` : ""}\n\n`;
		return {
			content: [{ type: "text", text: header + text }],
			details: { url: response.url, contentType, totalChars },
		};
	},
});

async function readLimited(response: Response, maxBytes: number): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (total < maxBytes) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.byteLength;
	}
	await reader.cancel().catch(() => {});
	return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(webSearchTool);
	pi.registerTool(webFetchTool);
}
