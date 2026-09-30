/**
 * Names of the tools this package registers.
 *
 * The profile translation (fleet/copilot-profiles.ts) refers to these tools
 * when it maps Copilot tool aliases, and the extensions register them, so both
 * sides import the names from here. The `fleet` prefix keeps them apart from
 * other pi packages: pi-subagents registers `subagent`, and pi-web-access
 * registers `web_search` and `web_fetch`.
 *
 * No pi imports, so `node --test` can load every module that uses it.
 */

export const FLEET_TOOL = "fleet";
export const WEB_SEARCH_TOOL = "fleet_web_search";
export const WEB_FETCH_TOOL = "fleet_web_fetch";
