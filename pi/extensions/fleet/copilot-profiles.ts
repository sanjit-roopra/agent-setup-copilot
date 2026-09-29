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
import { fileURLToPath } from "node:url";
import { FLEET_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from "../tool-names.ts";

/** Repository root: this file lives at `pi/extensions/fleet/copilot-profiles.ts`. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const PROFILE_DIR = path.join(".github", "agents");
const BUDGET_PROFILE_DIR = path.join("budget", "agents");
const PROFILE_SUFFIX = ".agent.md";
const COPILOT_PROVIDER = "github-copilot";

export type FleetVariant = "recommended" | "budget";

/** A specialist profile, translated to pi values. */
export interface FleetSpecialist {
	/** pi agent name, e.g. `fleet-explore` */
	name: string;
	/** Copilot display name, e.g. `Fleet Explore` */
	displayName: string;
	description: string;
	/**
	 * pi tool names. `undefined` means the profile declares no tools; an empty
	 * list means it declares tools that pi has no equivalent for, and the
	 * specialist must run with no tools rather than with pi's defaults.
	 */
	tools?: string[];
	/** `provider/model:thinking`, e.g. `github-copilot/claude-opus-5.5:medium` */
	model?: string;
	systemPrompt: string;
	filePath: string;
}

/** The coordinator profile (`Subagent Fleet`). */
export interface FleetCoordinator {
	displayName: string;
	/** Display names from the profile's `agents:` list. */
	allowedSpecialists: string[];
	tools?: string[];
	systemPrompt: string;
}

export interface FleetDefinition {
	specialists: FleetSpecialist[];
	coordinator?: FleetCoordinator;
	/** Problems found while loading, such as unreadable profiles or unknown tool aliases. */
	warnings: string[];
}

/** Copilot tool aliases mapped to pi tool names. */
const TOOL_ALIASES: Record<string, string[]> = {
	read: ["read"],
	search: ["grep", "find", "ls"],
	edit: ["edit", "write"],
	execute: ["bash"],
	web: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL],
	agent: [FLEET_TOOL],
};

type Frontmatter = Record<string, string | string[]>;

interface RawProfile {
	frontmatter: Frontmatter;
	body: string;
	filePath: string;
}

/**
 * Parse the small YAML subset the profiles use: `key: value`, quoted strings,
 * flow lists (`[a, "b"]`), and block lists (`key:` followed by `  - item`).
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
			frontmatter[key] = parseFlowList(raw);
			listKey = undefined;
		} else {
			frontmatter[key] = unquote(raw);
			listKey = undefined;
		}
	}
	return { frontmatter, body: content.slice(match[0].length).trim() };
}

/** `["read", search]` -> `["read", "search"]`. Items never contain commas in these profiles. */
function parseFlowList(raw: string): string[] {
	const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
	return inner
		.split(",")
		.map(unquote)
		.filter((item) => item !== "");
}

function unquote(value: string): string {
	const trimmed = value.trim();
	return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function stringField(frontmatter: Frontmatter, key: string): string | undefined {
	const value = frontmatter[key];
	return typeof value === "string" ? value : undefined;
}

function listField(frontmatter: Frontmatter, key: string): string[] | undefined {
	const value = frontmatter[key];
	return Array.isArray(value) ? value : undefined;
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
		.replace(/\(copilot\)\s*$/i, "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-");
	return effort ? `${COPILOT_PROVIDER}/${id}:${effort.trim()}` : `${COPILOT_PROVIDER}/${id}`;
}

/**
 * `["read", "search", "execute"]` -> `{ tools: ["read", "grep", "find", "ls", "bash"], unknown: [] }`.
 *
 * Fails closed: a declared list whose aliases are all unknown becomes `[]`
 * (no tools), never `undefined` (pi's default tools). Only an absent list is
 * `undefined`.
 */
export function toPiTools(copilotTools: string[] | undefined): { tools?: string[]; unknown: string[] } {
	if (copilotTools === undefined) return { tools: undefined, unknown: [] };
	const unknown = copilotTools.filter((tool) => !(tool in TOOL_ALIASES));
	const tools = copilotTools.flatMap((tool) => TOOL_ALIASES[tool] ?? []);
	return { tools: [...new Set(tools)], unknown };
}

/**
 * The pi CLI flags for an agent's tools: none for `undefined` (pi's defaults),
 * an allowlist for a non-empty list, and `--no-tools` for an empty list, so an
 * agent whose tools have no pi equivalent never falls back to the defaults.
 */
export function toolArgs(tools: string[] | undefined): string[] {
	if (!tools) return [];
	return tools.length > 0 ? ["--tools", tools.join(",")] : ["--no-tools"];
}

function readProfiles(dir: string, warnings: string[]): Map<string, RawProfile> {
	const profilesByDisplayName = new Map<string, RawProfile>();
	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch {
		return profilesByDisplayName;
	}
	for (const entry of entries.sort()) {
		if (!entry.endsWith(PROFILE_SUFFIX)) continue;
		const filePath = path.join(dir, entry);
		try {
			const { frontmatter, body } = parseProfileFrontmatter(fs.readFileSync(filePath, "utf-8"));
			const displayName = stringField(frontmatter, "name");
			if (displayName) profilesByDisplayName.set(displayName, { frontmatter, body, filePath });
			else warnings.push(`${filePath}: no name in frontmatter; skipped.`);
		} catch (error) {
			// One unreadable profile must not hide the rest of the fleet.
			warnings.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}; skipped.`);
		}
	}
	return profilesByDisplayName;
}

function translateTools(raw: RawProfile, warnings: string[]): string[] | undefined {
	const { tools, unknown } = toPiTools(listField(raw.frontmatter, "tools"));
	if (unknown.length > 0) {
		warnings.push(`${raw.filePath}: no pi equivalent for tools ${unknown.join(", ")}; they are left out.`);
	}
	return tools;
}

/**
 * Load the fleet from a repository checkout. The budget variant overlays the
 * profiles in `budget/agents/` onto the recommended ones by display name.
 */
export function loadFleet(repoRoot: string, variant: FleetVariant = "recommended"): FleetDefinition {
	const warnings: string[] = [];
	const profileDir = path.join(repoRoot, PROFILE_DIR);
	const profiles = readProfiles(profileDir, warnings);
	if (variant === "budget") {
		for (const [displayName, profile] of readProfiles(path.join(repoRoot, BUDGET_PROFILE_DIR), warnings)) {
			profiles.set(displayName, profile);
		}
	}

	const fleet: FleetDefinition = { specialists: [], warnings };
	for (const [displayName, raw] of profiles) {
		const { frontmatter, body, filePath } = raw;
		// The coordinator lists the specialists it may call; it is not one itself.
		const allowedSpecialists = listField(frontmatter, "agents");
		if (allowedSpecialists) {
			if (fleet.coordinator) {
				warnings.push(`${filePath}: another coordinator profile (${fleet.coordinator.displayName}) was already loaded; this one replaces it.`);
			}
			fleet.coordinator = {
				displayName,
				allowedSpecialists,
				tools: translateTools(raw, warnings),
				systemPrompt: body,
			};
			continue;
		}
		const description = stringField(frontmatter, "description");
		if (!description) {
			warnings.push(`${filePath}: no description in frontmatter; skipped.`);
			continue;
		}
		fleet.specialists.push({
			name: toAgentName(displayName),
			displayName,
			description,
			tools: translateTools(raw, warnings),
			model: toPiModel(stringField(frontmatter, "model"), stringField(frontmatter, "reasoning-effort")),
			systemPrompt: body,
			filePath,
		});
	}
	if (fleet.specialists.length === 0) warnings.push(`No fleet profiles found in ${profileDir}.`);
	return fleet;
}

export function variantFromEnv(env: Record<string, string | undefined> = process.env): FleetVariant {
	return env.PI_FLEET_VARIANT?.trim().toLowerCase() === "budget" ? "budget" : "recommended";
}

/** The fleet this package ships, in the variant selected by `PI_FLEET_VARIANT`. */
export function loadRepoFleet(): FleetDefinition {
	return loadFleet(REPO_ROOT, variantFromEnv());
}

export interface RosterEntry {
	name: string;
	displayName: string;
	description: string;
}

/**
 * The agents the coordinator may call, in the order its profile lists them,
 * and the listed names that match no agent. `agents` are the agents that will
 * actually run, so a user override's description wins over the packaged one.
 */
export function coordinatorRoster(
	coordinator: FleetCoordinator,
	agents: { name: string; description: string }[],
): { roster: RosterEntry[]; missing: string[] } {
	const roster: RosterEntry[] = [];
	const missing: string[] = [];
	for (const displayName of coordinator.allowedSpecialists) {
		const agent = agents.find((candidate) => candidate.name === toAgentName(displayName));
		if (agent) roster.push({ name: agent.name, displayName, description: agent.description });
		else missing.push(displayName);
	}
	return { roster, missing };
}

export type FleetRunPlan =
	| { ok: true; coordinator: FleetCoordinator; tools: string[] }
	| { ok: false; reason: string };

/** Whether /fleet may run: it needs a coordinator whose tools pi can use, and never runs with pi's defaults. */
export function planFleetRun(fleet: FleetDefinition): FleetRunPlan {
	const { coordinator } = fleet;
	if (!coordinator) return { ok: false, reason: "No Subagent Fleet coordinator profile found." };
	if (!coordinator.tools || coordinator.tools.length === 0) {
		return { ok: false, reason: "The coordinator profile declares no tools pi can use; /fleet will not run." };
	}
	return { ok: true, coordinator, tools: coordinator.tools };
}

/** The user message that turns the current session into the fleet coordinator. */
export function buildCoordinatorMessage(coordinator: FleetCoordinator, roster: RosterEntry[], task: string): string {
	return [
		`Act as the ${coordinator.displayName} coordinator for this task.`,
		"",
		coordinator.systemPrompt,
		"",
		`Delegate with the \`${FLEET_TOOL}\` tool. Specialists (use the name in backticks):`,
		...roster.map((agent) => `- \`${agent.name}\` (${agent.displayName}): ${agent.description}`),
		"",
		`Task: ${task}`,
	].join("\n");
}
