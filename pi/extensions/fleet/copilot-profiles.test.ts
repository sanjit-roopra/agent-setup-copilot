import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { before, describe, test, type TestContext } from "node:test";
import { FLEET_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from "../tool-names.ts";
import {
	buildCoordinatorMessage,
	coordinatorRoster,
	type FleetCoordinator,
	type FleetDefinition,
	loadFleet,
	parseProfileFrontmatter,
	planFleetRun,
	REPO_ROOT,
	toAgentName,
	toolArgs,
	toPiModel,
	trustArgs,
	toPiTools,
	variantFromEnv,
} from "./copilot-profiles.ts";

/** A throwaway repository with the given files, removed after the test. */
function makeRepo(t: TestContext, files: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-profiles-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (const [file, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), content);
	}
	return root;
}

const profile = (fields: string, body = "Instructions.") => `---\n${fields}\n---\n\n${body}\n`;

describe("toAgentName", () => {
	test("kebab-cases display names and trims separators", () => {
		assert.equal(toAgentName("Fleet Code Review"), "fleet-code-review");
		assert.equal(toAgentName(" Fleet: Task! "), "fleet-task");
	});
});

describe("toPiModel", () => {
	test("maps a Copilot display name and effort to provider/id:thinking", () => {
		assert.equal(toPiModel("Claude Opus 5.5 (copilot)", "medium"), "github-copilot/claude-opus-5.5:medium");
		assert.equal(toPiModel("GPT-6 Luna (copilot)", " low "), "github-copilot/gpt-6-luna:low");
	});

	test("omits the thinking level when there is no effort", () => {
		assert.equal(toPiModel("Claude Sonnet 5.5", undefined), "github-copilot/claude-sonnet-5.5");
	});

	test("returns undefined without a model", () => {
		assert.equal(toPiModel(undefined, "high"), undefined);
	});
});

describe("toPiTools", () => {
	test("expands Copilot aliases without duplicates", () => {
		assert.deepEqual(toPiTools(["read", "search", "execute", "read"]), {
			tools: ["read", "grep", "find", "ls", "bash"],
			unknown: [],
		});
		assert.deepEqual(toPiTools(["web", "agent"]).tools, [WEB_SEARCH_TOOL, WEB_FETCH_TOOL, FLEET_TOOL]);
	});

	test("fails closed: unknown aliases give an empty list, not pi's default tools", () => {
		assert.deepEqual(toPiTools(["todo", "github/*"]), { tools: [], unknown: ["todo", "github/*"] });
		assert.deepEqual(toPiTools(["read", "todo"]), { tools: ["read"], unknown: ["todo"] });
	});

	test("returns undefined tools only when the profile declares none", () => {
		assert.deepEqual(toPiTools(undefined), { tools: undefined, unknown: [] });
	});
});

describe("toolArgs", () => {
	test("passes no flag when the profile declares no tools, so pi's defaults apply", () => {
		assert.deepEqual(toolArgs(undefined), []);
	});

	test("passes an allowlist for declared tools", () => {
		assert.deepEqual(toolArgs(["read", "grep"]), ["--tools", "read,grep"]);
	});

	test("passes --no-tools when none of the declared tools has a pi equivalent", () => {
		assert.deepEqual(toolArgs([]), ["--no-tools"]);
	});
});

describe("trustArgs", () => {
	test("passes the parent's trust to a child in the same project", () => {
		assert.deepEqual(trustArgs(true, "/work/repo", "/work/repo/"), ["--approve"]);
	});

	test("never passes trust to a child in another directory", () => {
		assert.deepEqual(trustArgs(true, "/work/repo", "/work/other"), []);
		assert.deepEqual(trustArgs(true, "/work/repo", "/work/repo/sub"), []);
	});

	test("passes nothing when the parent does not trust the project", () => {
		assert.deepEqual(trustArgs(false, "/work/repo", "/work/repo"), []);
	});
});

describe("parseProfileFrontmatter", () => {
	test("reads quoted values, quoted and unquoted flow lists, and block lists", () => {
		const { frontmatter, body } = parseProfileFrontmatter(
			profile('name: X\nmodel: "M (copilot)"\ntools: ["read", "search"]\nother: [read, search]\nagents:\n  - A\n  - "B"', "Body text"),
		);
		assert.deepEqual(frontmatter, {
			name: "X",
			model: "M (copilot)",
			tools: ["read", "search"],
			other: ["read", "search"],
			agents: ["A", "B"],
		});
		assert.equal(body, "Body text");
	});

	test("reads Windows line endings", () => {
		assert.deepEqual(parseProfileFrontmatter("---\r\nname: X\r\n---\r\nBody").frontmatter, { name: "X" });
	});

	test("treats a file without frontmatter as body only", () => {
		assert.deepEqual(parseProfileFrontmatter("Just text"), { frontmatter: {}, body: "Just text" });
	});
});

describe("loadFleet", () => {
	const specialist = (name: string, extra = "") =>
		profile(`name: ${name}\ndescription: Does ${name}.\ntools: ["read"]\nmodel: "Claude Sonnet 5.5 (copilot)"\nreasoning-effort: low${extra}`);

	test("separates the coordinator from the specialists", (t) => {
		const root = makeRepo(t, {
			".github/agents/coord.agent.md": profile('name: Coord\ntools: ["agent", "read"]\nagents:\n  - Fleet A', "Coordinate."),
			".github/agents/a.agent.md": specialist("Fleet A"),
		});
		const fleet = loadFleet(root);
		assert.deepEqual(fleet.coordinator, {
			displayName: "Coord",
			allowedSpecialists: ["Fleet A"],
			tools: [FLEET_TOOL, "read"],
			systemPrompt: "Coordinate.",
		});
		assert.deepEqual(
			fleet.specialists.map((s) => [s.name, s.model, s.tools]),
			[["fleet-a", "github-copilot/claude-sonnet-5.5:low", ["read"]]],
		);
		assert.deepEqual(fleet.warnings, []);
	});

	test("overlays budget profiles by display name", (t) => {
		const root = makeRepo(t, {
			".github/agents/a.agent.md": specialist("Fleet A"),
			"budget/agents/a.agent.md": profile('name: Fleet A\ndescription: Cheaper.\ntools: ["read"]\nmodel: "GPT-6 Luna (copilot)"'),
		});
		assert.equal(loadFleet(root, "recommended").specialists[0].model, "github-copilot/claude-sonnet-5.5:low");
		assert.equal(loadFleet(root, "budget").specialists[0].model, "github-copilot/gpt-6-luna");
	});

	test("keeps a specialist with unknown tools, with no tools, and warns", (t) => {
		const root = makeRepo(t, { ".github/agents/a.agent.md": profile('name: Fleet A\ndescription: A.\ntools: ["todo"]') });
		const fleet = loadFleet(root);
		assert.deepEqual(fleet.specialists[0].tools, []);
		assert.match(fleet.warnings.join("\n"), /no pi equivalent for tools todo/);
	});

	test("skips profiles without a name or description, and unreadable files, with a warning each", (t) => {
		const root = makeRepo(t, {
			".github/agents/good.agent.md": specialist("Fleet Good"),
			".github/agents/noname.agent.md": profile("description: D."),
			".github/agents/nodesc.agent.md": profile("name: Fleet NoDesc"),
		});
		fs.mkdirSync(path.join(root, ".github/agents/dir.agent.md"));
		const fleet = loadFleet(root);
		assert.deepEqual(
			fleet.specialists.map((s) => s.name),
			["fleet-good"],
		);
		const warnings = fleet.warnings.join("\n");
		assert.match(warnings, /dir\.agent\.md: .*skipped/);
		assert.match(warnings, /noname\.agent\.md: no name in frontmatter/);
		assert.match(warnings, /nodesc\.agent\.md: no description in frontmatter/);
		assert.equal(fleet.warnings.length, 3, warnings);
	});

	test("warns when a second profile claims to be the coordinator", (t) => {
		const root = makeRepo(t, {
			".github/agents/a.agent.md": profile("name: First\nagents:\n  - X"),
			".github/agents/b.agent.md": profile("name: Second\nagents:\n  - X"),
		});
		const fleet = loadFleet(root);
		assert.equal(fleet.coordinator?.displayName, "Second");
		assert.match(fleet.warnings.join("\n"), /another coordinator profile \(First\)/);
	});

	test("warns when there are no profiles", (t) => {
		assert.match(loadFleet(makeRepo(t, {})).warnings.join("\n"), /No fleet profiles found/);
	});
});

describe("coordinator message", () => {
	const coordinator: FleetCoordinator = {
		displayName: "Subagent Fleet",
		allowedSpecialists: ["Fleet B", "Fleet A", "Fleet Missing"],
		tools: [FLEET_TOOL],
		systemPrompt: "Coordinate carefully.",
	};
	const agents = [
		{ name: "fleet-a", description: "Overridden A." },
		{ name: "fleet-b", description: "B." },
		{ name: "fleet-c", description: "Not allowed." },
	];

	test("the roster follows the coordinator's list and skips agents it does not name", () => {
		assert.deepEqual(coordinatorRoster(coordinator, agents).roster, [
			{ name: "fleet-b", displayName: "Fleet B", description: "B." },
			{ name: "fleet-a", displayName: "Fleet A", description: "Overridden A." },
		]);
	});

	test("the roster reports listed names that match no agent", () => {
		assert.deepEqual(coordinatorRoster(coordinator, agents).missing, ["Fleet Missing"]);
	});

	test("the message holds the instructions, the roster, and the task last", () => {
		const message = buildCoordinatorMessage(coordinator, coordinatorRoster(coordinator, agents).roster, "Fix the bug.");
		assert.equal(
			message,
			[
				"Act as the Subagent Fleet coordinator for this task.",
				"",
				"Coordinate carefully.",
				"",
				"Delegate with the `fleet` tool. Specialists (use the name in backticks):",
				"- `fleet-b` (Fleet B): B.",
				"- `fleet-a` (Fleet A): Overridden A.",
				"",
				"Task: Fix the bug.",
			].join("\n"),
		);
	});
});

describe("planFleetRun", () => {
	const coordinator: FleetCoordinator = { displayName: "C", allowedSpecialists: [], tools: [FLEET_TOOL], systemPrompt: "" };
	const fleetWith = (value?: FleetCoordinator): FleetDefinition => ({ specialists: [], coordinator: value, warnings: [] });

	test("refuses without a coordinator", () => {
		assert.deepEqual(planFleetRun(fleetWith(undefined)), { ok: false, reason: "No Subagent Fleet coordinator profile found." });
	});

	test("refuses when the coordinator's tools are missing or untranslatable", () => {
		const reason = "The coordinator profile declares no tools pi can use; /fleet will not run.";
		for (const tools of [undefined, []]) {
			assert.deepEqual(planFleetRun(fleetWith({ ...coordinator, tools })), { ok: false, reason }, JSON.stringify(tools));
		}
	});

	test("runs with exactly the coordinator's tools", () => {
		assert.deepEqual(planFleetRun(fleetWith(coordinator)), { ok: true, coordinator, tools: [FLEET_TOOL] });
	});
});

describe("variantFromEnv", () => {
	test("defaults to recommended and accepts budget in any case", () => {
		assert.equal(variantFromEnv({}), "recommended");
		assert.equal(variantFromEnv({ PI_FLEET_VARIANT: " Budget " }), "budget");
		assert.equal(variantFromEnv({ PI_FLEET_VARIANT: "cheap" }), "recommended");
	});
});

/**
 * Drift checks against this repository's real profiles. A failure here means
 * a profile in .github/agents/ or budget/agents/ changed; update the expected
 * values if the change was intended. The expected models and tools match the
 * tables in USAGE.md (Model assignments) and budget/README.md.
 */
describe("repository profiles", () => {
	let recommended: FleetDefinition;
	let budget: FleetDefinition;
	// Loaded in a hook, not at collection time, so a load failure is reported as a test failure.
	before(() => {
		recommended = loadFleet(REPO_ROOT, "recommended");
		budget = loadFleet(REPO_ROOT, "budget");
	});
	const find = (fleet: FleetDefinition, name: string) => {
		const found = fleet.specialists.find((s) => s.name === name);
		assert.ok(found, `${name} missing`);
		return found;
	};

	test("load without warnings", () => {
		assert.deepEqual([...recommended.warnings, ...budget.warnings], []);
	});

	test("the coordinator allows exactly the seven specialists", () => {
		assert.deepEqual(
			recommended.coordinator?.allowedSpecialists.map(toAgentName).sort(),
			recommended.specialists.map((s) => s.name).sort(),
		);
		assert.equal(recommended.specialists.length, 7);
	});

	test("the coordinator can delegate, read, and search, but not edit or run commands", () => {
		assert.deepEqual(recommended.coordinator?.tools, [FLEET_TOOL, "read", "grep", "find", "ls"]);
	});

	test("every specialist has a Copilot model with effort, and tools without the fleet tool", () => {
		for (const s of recommended.specialists) {
			assert.match(s.model ?? "", /^github-copilot\/[a-z0-9.-]+:(low|medium|high)$/, s.name);
			assert.ok(s.tools && s.tools.length > 0, `${s.name} has no tools`);
			assert.ok(!s.tools.includes(FLEET_TOOL), `${s.name} could delegate again`);
		}
	});

	test("review and research specialists get no edit or write tool (explore and reviewers still have bash)", () => {
		for (const name of ["fleet-explore", "fleet-code-review", "fleet-rubber-duck", "fleet-security-review", "fleet-research"]) {
			const tools = find(recommended, name).tools;
			assert.ok(tools, name);
			assert.ok(!tools.includes("edit") && !tools.includes("write"), name);
		}
	});

	test("general purpose can read, search, edit, and run commands", () => {
		assert.deepEqual(find(recommended, "fleet-general-purpose").tools, ["read", "grep", "find", "ls", "edit", "write", "bash"]);
	});

	test("research gets the web tools", () => {
		assert.deepEqual(find(recommended, "fleet-research").tools, ["read", "grep", "find", "ls", WEB_SEARCH_TOOL, WEB_FETCH_TOOL]);
	});

	test("budget changes the models of General Purpose and Explore only", () => {
		const changed = recommended.specialists.filter((r) => find(budget, r.name).model !== r.model).map((r) => r.name);
		assert.deepEqual(changed.sort(), ["fleet-explore", "fleet-general-purpose"]);
		assert.equal(find(budget, "fleet-general-purpose").model, "github-copilot/claude-sonnet-5.5:medium");
		assert.equal(find(budget, "fleet-explore").model, "github-copilot/gpt-6-luna:medium");
	});

	test("budget keeps every specialist's tools and instructions", () => {
		for (const r of recommended.specialists) {
			const b = find(budget, r.name);
			assert.deepEqual(b.tools, r.tools, `${r.name} tools`);
			assert.equal(b.systemPrompt, r.systemPrompt, `${r.name} instructions`);
		}
	});
});
