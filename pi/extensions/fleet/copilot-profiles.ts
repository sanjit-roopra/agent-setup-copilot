/**
 * Translate this repository's Copilot agent profiles into pi subagent configs.
 *
 * The `.github/agents/*.agent.md` files stay the single source of truth for
 * every harness: pi reads them at runtime and maps their Copilot-specific
 * frontmatter (display model names, `reasoning-effort`, tool aliases) onto the
 * `--model` and `--tools` values a pi child process accepts.
 *
 * This module has no pi imports so `node --test` can exercise it directly.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type FleetVariant = "recommended" | "budget";

export interface FleetProfile {
	/** pi agent name, e.g. `fleet-explore` */
	name: string;
	/** Copilot display name, e.g. `Fleet Explore` */
	displayName: string;
	description: string;
	tools?: string[];
	/** `provider/model:thinking`, e.g. `github-copilot/claude-opus-5.5:medium` */
	model?: string;
	systemPrompt: string;
	filePath: string;
}

export interface FleetDefinition {
	specialists: FleetProfile[];
	/** The coordinator profile (`Subagent Fleet`), if present. */
	coordinator?: { displayName: string; tools?: string[]; systemPrompt: string };
}

const COPILOT_PROVIDER = "github-copilot";

/** Copilot tool aliases mapped to pi tool names. */
const TOOL_ALIASES: Record<string, string[]> = {
	read: ["read"],
	search: ["grep", "find", "ls"],
	edit: ["edit", "write"],
	execute: ["bash"],
	web: ["fleet_web_search", "fleet_web_fetch"],
	agent: ["fleet"],
};

type Frontmatter = Record<string, string | string[]>;

/**
 * Parse the small YAML subset the profiles use: `key: value`, quoted strings,
 * inline JSON arrays, and block lists (`key:` followed by `  - item`).
 */
export function parseProfileFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
	if (!match) return { frontmatter: {}, body: content };

	const frontmatter: Frontmatter = {};
	let listKey: string | undefined;
	for (const line of match[1].split(/\r?\n/)) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item && listKey) {
			(frontmatter[listKey] as string[]).push(unquote(item[1]));
			continue;
		}
		const pair = /^([\w-]+):\s*(.*)$/.exec(line);
		if (!pair) continue;
		const [, key, raw] = pair;
		if (raw === "") {
			frontmatter[key] = [];
			listKey = key;
		} else if (raw.startsWith("[")) {
			frontmatter[key] = (JSON.parse(raw) as unknown[]).map(String);
			listKey = undefined;
		} else {
			frontmatter[key] = unquote(raw);
			listKey = undefined;
		}
	}
	return { frontmatter, body: content.slice(match[0].length).trim() };
}

function unquote(value: string): string {
	const trimmed = value.trim();
	return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/** `Fleet Code Review` -> `fleet-code-review` */
export function toAgentName(displayName: string): string {
	return displayName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** `Claude Opus 5.5 (copilot)` + `medium` -> `github-copilot/claude-opus-5.5:medium` */
export function toPiModel(copilotModel: string | undefined, effort: string | undefined): string | undefined {
	if (!copilotModel) return undefined;
	const id = copilotModel
		.replace(/\((copilot)\)\s*$/i, "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-");
	return effort ? `${COPILOT_PROVIDER}/${id}:${effort.trim()}` : `${COPILOT_PROVIDER}/${id}`;
}

/** `["read", "search", "execute"]` -> `["read", "grep", "find", "ls", "bash"]` */
export function toPiTools(copilotTools: string[] | undefined): string[] | undefined {
	if (!copilotTools || copilotTools.length === 0) return undefined;
	const tools = copilotTools.flatMap((tool) => TOOL_ALIASES[tool] ?? []);
	return tools.length > 0 ? [...new Set(tools)] : undefined;
}

function readProfiles(dir: string): Map<string, { frontmatter: Frontmatter; body: string; filePath: string }> {
	const profiles = new Map<string, { frontmatter: Frontmatter; body: string; filePath: string }>();
	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch {
		return profiles;
	}
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".agent.md")) continue;
		const filePath = path.join(dir, entry);
		try {
			const { frontmatter, body } = parseProfileFrontmatter(fs.readFileSync(filePath, "utf-8"));
			if (typeof frontmatter.name === "string") profiles.set(frontmatter.name, { frontmatter, body, filePath });
		} catch {
			// One malformed profile must not hide the rest of the fleet.
		}
	}
	return profiles;
}

/**
 * Load the fleet from a repository checkout. The budget variant overlays the
 * profiles in `budget/agents/` onto the recommended ones by display name.
 */
export function loadFleet(repoRoot: string, variant: FleetVariant = "recommended"): FleetDefinition {
	const profiles = readProfiles(path.join(repoRoot, ".github", "agents"));
	if (variant === "budget") {
		for (const [name, profile] of readProfiles(path.join(repoRoot, "budget", "agents"))) profiles.set(name, profile);
	}

	const fleet: FleetDefinition = { specialists: [] };
	for (const [displayName, { frontmatter, body, filePath }] of profiles) {
		// The coordinator lists the specialists it may call; it is not one itself.
		if (Array.isArray(frontmatter.agents)) {
			fleet.coordinator = {
				displayName,
				tools: toPiTools(Array.isArray(frontmatter.tools) ? frontmatter.tools : undefined),
				systemPrompt: body,
			};
			continue;
		}
		if (typeof frontmatter.description !== "string") continue;
		fleet.specialists.push({
			name: toAgentName(displayName),
			displayName,
			description: frontmatter.description,
			tools: toPiTools(Array.isArray(frontmatter.tools) ? frontmatter.tools : undefined),
			model: toPiModel(
				typeof frontmatter.model === "string" ? frontmatter.model : undefined,
				typeof frontmatter["reasoning-effort"] === "string" ? frontmatter["reasoning-effort"] : undefined,
			),
			systemPrompt: body,
			filePath,
		});
	}
	return fleet;
}

export function variantFromEnv(env: Record<string, string | undefined> = process.env): FleetVariant {
	return env.PI_FLEET_VARIANT?.trim().toLowerCase() === "budget" ? "budget" : "recommended";
}
