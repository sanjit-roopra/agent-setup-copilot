/**
 * Web tools for the fleet: `fleet_web_search` and `fleet_web_fetch`.
 *
 * - Search goes through GitHub's hosted MCP server with the user's existing
 *   GitHub login, so it needs no API key and no MCP configuration.
 * - Fetch runs locally and refuses private, loopback, and metadata addresses.
 *
 * The logic lives in pi-free modules (github-search.ts, web-fetch.ts) so it
 * can be unit tested; this file only registers the tools.
 */

import * as path from "node:path";
import { defineTool, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from "../tool-names.ts";
import { findGitHubTokens, searchWithFallback } from "./github-search.ts";
import { fetchPage, formatFetchedPage } from "./web-fetch.ts";

const DEFAULT_MAX_CHARS = 50_000;

const webSearchTool = defineTool({
	name: WEB_SEARCH_TOOL,
	label: "Web Search",
	description: `Search the web and get an answer with cited source URLs. Ask one specific natural-language question per call. Use ${WEB_FETCH_TOOL} to read a cited page in full.`,
	parameters: Type.Object({
		query: Type.String({ description: "One specific question, e.g. 'What changed in React 19.2?'" }),
	}),

	async execute(_toolCallId, params, signal) {
		const candidates = await findGitHubTokens(path.join(getAgentDir(), "auth.json"));
		const { text, tokenSource } = await searchWithFallback(params.query, candidates, signal);
		return { content: [{ type: "text", text }], details: { tokenSource } };
	},
});

const webFetchTool = defineTool({
	name: WEB_FETCH_TOOL,
	label: "Web Fetch",
	description: "Fetch a public http(s) URL and return its content as Markdown text (HTML) or raw text (other types).",
	parameters: Type.Object({
		url: Type.String({ description: "The http or https URL to fetch" }),
		maxChars: Type.Optional(
			Type.Number({ minimum: 1000, description: `Maximum characters to return (default ${DEFAULT_MAX_CHARS})` }),
		),
	}),

	async execute(_toolCallId, params, signal) {
		const page = await fetchPage(params.url, { signal });
		return {
			content: [{ type: "text", text: formatFetchedPage(page, params.maxChars ?? DEFAULT_MAX_CHARS) }],
			details: { url: page.url, contentType: page.contentType, totalChars: page.text.length },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(webSearchTool);
	pi.registerTool(webFetchTool);
}
