import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadFleet, parseProfileFrontmatter, toAgentName, toPiModel, toPiTools, variantFromEnv } from "./copilot-profiles.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function specialist(variant: "recommended" | "budget", name: string) {
	const found = loadFleet(REPO_ROOT, variant).specialists.find((s) => s.name === name);
	assert.ok(found, `${name} missing from the ${variant} fleet`);
	return found;
}

test("toAgentName kebab-cases display names", () => {
	assert.equal(toAgentName("Fleet Code Review"), "fleet-code-review");
});

test("toPiModel maps Copilot display names and effort to provider/id:thinking", () => {
	assert.equal(toPiModel("Claude Opus 5.5 (copilot)", "medium"), "github-copilot/claude-opus-5.5:medium");
	assert.equal(toPiModel("GPT-6 Luna (copilot)", "low"), "github-copilot/gpt-6-luna:low");
	assert.equal(toPiModel("Claude Sonnet 5.5 (copilot)", undefined), "github-copilot/claude-sonnet-5.5");
	assert.equal(toPiModel(undefined, "high"), undefined);
});

test("toPiTools expands Copilot aliases and drops unknown ones", () => {
	assert.deepEqual(toPiTools(["read", "search", "execute"]), ["read", "grep", "find", "ls", "bash"]);
	assert.deepEqual(toPiTools(["read", "web"]), ["read", "fleet_web_search", "fleet_web_fetch"]);
	assert.deepEqual(toPiTools(["agent", "read"]), ["fleet", "read"]);
	assert.equal(toPiTools(["unknown"]), undefined);
	assert.equal(toPiTools([]), undefined);
});

test("parseProfileFrontmatter reads inline arrays, block lists, and quoted values", () => {
	const { frontmatter, body } = parseProfileFrontmatter(
		'---\nname: X\nmodel: "M (copilot)"\ntools: ["read", "search"]\nagents:\n  - A\n  - B\n---\n\nBody text\n',
	);
	assert.equal(frontmatter.name, "X");
	assert.equal(frontmatter.model, "M (copilot)");
	assert.deepEqual(frontmatter.tools, ["read", "search"]);
	assert.deepEqual(frontmatter.agents, ["A", "B"]);
	assert.equal(body, "Body text");
});

test("recommended fleet loads all seven specialists and the coordinator", () => {
	const fleet = loadFleet(REPO_ROOT, "recommended");
	assert.deepEqual(fleet.specialists.map((s) => s.name).sort(), [
		"fleet-code-review",
		"fleet-explore",
		"fleet-general-purpose",
		"fleet-research",
		"fleet-rubber-duck",
		"fleet-security-review",
		"fleet-task",
	]);
	assert.equal(fleet.coordinator?.displayName, "Subagent Fleet");
	assert.deepEqual(fleet.coordinator?.tools, ["fleet", "read", "grep", "find", "ls"]);
	assert.match(fleet.coordinator?.systemPrompt ?? "", /Do not edit files yourself/);
});

test("every specialist has a model, tools, and no fleet tool", () => {
	for (const s of loadFleet(REPO_ROOT, "recommended").specialists) {
		assert.match(s.model ?? "", /^github-copilot\/[a-z0-9.-]+:(low|medium|high)$/, s.name);
		assert.ok(s.tools && s.tools.length > 0, `${s.name} has no tools`);
		assert.ok(!s.tools.includes("fleet"), `${s.name} could delegate again`);
	}
});

test("read-only specialists cannot edit files", () => {
	for (const name of ["fleet-explore", "fleet-code-review", "fleet-rubber-duck", "fleet-security-review", "fleet-research"]) {
		const tools = specialist("recommended", name).tools ?? [];
		assert.ok(!tools.includes("edit") && !tools.includes("write"), name);
	}
	assert.deepEqual(specialist("recommended", "fleet-general-purpose").tools, [
		"read",
		"grep",
		"find",
		"ls",
		"edit",
		"write",
		"bash",
	]);
	assert.deepEqual(specialist("recommended", "fleet-research").tools, [
		"read",
		"grep",
		"find",
		"ls",
		"fleet_web_search",
		"fleet_web_fetch",
	]);
});

test("budget variant changes only General Purpose and Explore models", () => {
	const recommended = loadFleet(REPO_ROOT, "recommended").specialists;
	const budget = loadFleet(REPO_ROOT, "budget").specialists;
	assert.equal(specialist("recommended", "fleet-general-purpose").model, "github-copilot/claude-opus-5.5:medium");
	assert.equal(specialist("budget", "fleet-general-purpose").model, "github-copilot/claude-sonnet-5.5:medium");
	assert.equal(specialist("recommended", "fleet-explore").model, "github-copilot/claude-sonnet-5.5:low");
	assert.equal(specialist("budget", "fleet-explore").model, "github-copilot/gpt-6-luna:medium");
	for (const r of recommended) {
		const b = budget.find((s) => s.name === r.name);
		assert.ok(b, r.name);
		assert.deepEqual(b.tools, r.tools, `${r.name} tools differ between variants`);
		assert.equal(b.systemPrompt, r.systemPrompt, `${r.name} instructions differ between variants`);
		if (r.name !== "fleet-general-purpose" && r.name !== "fleet-explore") assert.equal(b.model, r.model, r.name);
	}
});

test("variantFromEnv defaults to recommended", () => {
	assert.equal(variantFromEnv({}), "recommended");
	assert.equal(variantFromEnv({ PI_FLEET_VARIANT: "Budget" }), "budget");
	assert.equal(variantFromEnv({ PI_FLEET_VARIANT: "cheap" }), "recommended");
});
