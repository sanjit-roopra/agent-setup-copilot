import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FLEET_TOOL } from "../tool-names.ts";
import type { FleetCoordinator } from "./copilot-profiles.ts";
import {
	applyCoordinatorModel,
	COORDINATOR_MODEL_ENV,
	type CoordinatorModelChoice,
	coordinatorModelChoice,
	parsePiModel,
	type SessionModelControl,
	type ThinkingLevelName,
} from "./coordinator-model.ts";

describe("parsePiModel", () => {
	test("reads provider/id with an optional thinking level", () => {
		assert.deepEqual(parsePiModel("github-copilot/gpt-6.1-sol:medium"), { provider: "github-copilot", id: "gpt-6.1-sol", thinking: "medium" });
		assert.deepEqual(parsePiModel(" github-copilot/claude-opus-5.5 "), { provider: "github-copilot", id: "claude-opus-5.5" });
		assert.deepEqual(parsePiModel("openrouter/openai/gpt-5:high"), { provider: "openrouter", id: "openai/gpt-5", thinking: "high" });
	});

	test("reads the thinking level in any case", () => {
		assert.deepEqual(parsePiModel("github-copilot/claude-opus-5.5:High"), { provider: "github-copilot", id: "claude-opus-5.5", thinking: "high" });
	});

	test("keeps a colon in the id when the suffix is not a thinking level", () => {
		assert.deepEqual(parsePiModel("ollama/llama3:8b"), { provider: "ollama", id: "llama3:8b" });
		assert.deepEqual(parsePiModel("ollama/llama3:8b:low"), { provider: "ollama", id: "llama3:8b", thinking: "low" });
		assert.deepEqual(parsePiModel("acme/high"), { provider: "acme", id: "high" });
	});

	test("rejects text without a provider or an id, or with whitespace", () => {
		for (const spec of ["gpt-6.1-sol", "github-copilot/", "/gpt-6.1-sol", "github-copilot/:medium", "github-copilot/gpt 6", "a:b/c"]) {
			assert.equal(parsePiModel(spec), undefined, spec);
		}
	});
});

describe("coordinatorModelChoice", () => {
	const coordinator: FleetCoordinator = {
		displayName: "C",
		allowedSpecialists: [],
		tools: [FLEET_TOOL],
		model: "github-copilot/gpt-6.1-sol:medium",
		systemPrompt: "",
	};
	const fromProfile: CoordinatorModelChoice = {
		kind: "switch",
		target: { provider: "github-copilot", id: "gpt-6.1-sol", thinking: "medium" },
		source: "profile",
	};

	test("uses the profile's model and effort by default", () => {
		assert.deepEqual(coordinatorModelChoice(coordinator, {}), fromProfile);
	});

	test("ignores a blank override", () => {
		assert.deepEqual(coordinatorModelChoice(coordinator, { [COORDINATOR_MODEL_ENV]: "  " }), fromProfile);
	});

	test("keeps the session's model when the override is session, in any case", () => {
		assert.deepEqual(coordinatorModelChoice(coordinator, { [COORDINATOR_MODEL_ENV]: " Session " }), { kind: "session" });
	});

	test("uses the model the override names", () => {
		assert.deepEqual(coordinatorModelChoice(coordinator, { [COORDINATOR_MODEL_ENV]: "github-copilot/claude-opus-5.5:high" }), {
			kind: "switch",
			target: { provider: "github-copilot", id: "claude-opus-5.5", thinking: "high" },
			source: "env",
		});
	});

	test("uses the override even when the profile sets no model", () => {
		const choice = coordinatorModelChoice({ ...coordinator, model: undefined }, { [COORDINATOR_MODEL_ENV]: "github-copilot/gpt-6-luna" });
		assert.deepEqual(choice, { kind: "switch", target: { provider: "github-copilot", id: "gpt-6-luna" }, source: "env" });
	});

	test("reports an override it cannot read instead of ignoring it", () => {
		assert.deepEqual(coordinatorModelChoice(coordinator, { [COORDINATOR_MODEL_ENV]: "opus" }), {
			kind: "invalid",
			reason: 'PI_FLEET_COORDINATOR_MODEL=opus is not "session" or provider/model[:thinking], e.g. github-copilot/claude-opus-5.5:high.',
		});
	});

	test("reports a profile model it cannot read", () => {
		assert.deepEqual(coordinatorModelChoice({ ...coordinator, model: "not-a-model" }, {}), {
			kind: "invalid",
			reason: "The coordinator profile's model not-a-model cannot be used in pi.",
		});
	});

	test("keeps the session's model when the profile sets none", () => {
		assert.deepEqual(coordinatorModelChoice({ ...coordinator, model: undefined }, {}), { kind: "session" });
	});
});

describe("applyCoordinatorModel", () => {
	type FakeModel = { provider: string; id: string };
	const sonnet: FakeModel = { provider: "github-copilot", id: "claude-sonnet-5.5" };
	const sol: FakeModel = { provider: "github-copilot", id: "gpt-6.1-sol" };

	/**
	 * A session on Sonnet with high thinking that records every change. `loginFor` lists the models
	 * setModel accepts; `failThinking` makes setThinking throw for that level.
	 */
	function fakeSession(options: { start?: FakeModel; known?: FakeModel[]; loginFor?: FakeModel[]; failThinking?: ThinkingLevelName } = {}) {
		const known = options.known ?? [sol, sonnet];
		const loginFor = options.loginFor ?? known;
		const state = { model: "start" in options ? options.start : sonnet, thinking: "high" as ThinkingLevelName, calls: [] as string[] };
		const control: SessionModelControl<FakeModel> = {
			currentModel: () => state.model,
			currentThinking: () => state.thinking,
			find: (provider, id) => known.find((m) => m.provider === provider && m.id === id),
			setModel: async (model) => {
				state.calls.push(`model ${model.id}`);
				if (!loginFor.includes(model)) return false;
				state.model = model;
				return true;
			},
			setThinking: (level) => {
				state.calls.push(`thinking ${level}`);
				if (level === options.failThinking) throw new Error("unsupported");
				state.thinking = level;
			},
		};
		return { state, control };
	}
	const toSol: CoordinatorModelChoice = {
		kind: "switch",
		target: { provider: "github-copilot", id: "gpt-6.1-sol", thinking: "medium" },
		source: "profile",
	};

	test("switches to the chosen model and effort", async () => {
		const { state, control } = fakeSession();
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(result.ok);
		assert.equal(result.switchedTo, "github-copilot/gpt-6.1-sol:medium");
		assert.deepEqual([state.model?.id, state.thinking], ["gpt-6.1-sol", "medium"]);
	});

	test("sets the model before the thinking level, which pi limits to what the model supports", async () => {
		const { state, control } = fakeSession();
		await applyCoordinatorModel(toSol, control);
		assert.deepEqual(state.calls, ["model gpt-6.1-sol", "thinking medium"]);
	});

	test("restore puts back the session's model, then its thinking level", async () => {
		const { state, control } = fakeSession();
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(result.ok);
		state.calls.length = 0;
		await result.restore();
		assert.deepEqual([state.model?.id, state.thinking], ["claude-sonnet-5.5", "high"]);
		assert.deepEqual(state.calls, ["model claude-sonnet-5.5", "thinking high"]);
	});

	test("keeps the session's thinking level when the target names none", async () => {
		const { state, control } = fakeSession();
		const result = await applyCoordinatorModel({ ...toSol, target: { provider: "github-copilot", id: "gpt-6.1-sol" } }, control);
		assert.ok(result.ok);
		assert.equal(result.switchedTo, "github-copilot/gpt-6.1-sol");
		assert.deepEqual([state.model?.id, state.thinking], ["gpt-6.1-sol", "high"]);
	});

	test("changes nothing for the session choice", async () => {
		const { state, control } = fakeSession();
		const result = await applyCoordinatorModel({ kind: "session" }, control);
		assert.ok(result.ok);
		assert.equal(result.switchedTo, undefined);
		await result.restore();
		assert.deepEqual(state.calls, []);
	});

	test("refuses an unknown model without touching the session", async () => {
		const { state, control } = fakeSession({ known: [sonnet] });
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(!result.ok);
		assert.match(result.reason, /github-copilot\/gpt-6\.1-sol not found.*PI_FLEET_COORDINATOR_MODEL=session/);
		assert.deepEqual(state.calls, []);
	});

	test("points out a suffix that is not a thinking level when the model is not found", async () => {
		const { control } = fakeSession();
		const result = await applyCoordinatorModel({ ...toSol, target: { provider: "github-copilot", id: "gpt-6.1-sol:hgih" } }, control);
		assert.ok(!result.ok);
		assert.match(result.reason, /If ":hgih" was meant as a thinking level, use one of off, minimal, low, medium, high, xhigh, max\./);
	});

	test("refuses a model without a login and leaves the thinking level alone", async () => {
		const { state, control } = fakeSession({ loginFor: [sonnet] });
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(!result.ok);
		assert.match(result.reason, /no login configured/);
		assert.deepEqual([state.model?.id, state.thinking], ["claude-sonnet-5.5", "high"]);
	});

	test("puts the session back when the thinking level cannot be set", async () => {
		const { state, control } = fakeSession({ failThinking: "medium" });
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(!result.ok);
		assert.match(result.reason, /thinking level medium/);
		assert.deepEqual([state.model?.id, state.thinking], ["claude-sonnet-5.5", "high"]);
	});

	test("says which model the session stays on when undoing a failed thinking change also fails", async () => {
		const { state, control } = fakeSession({ failThinking: "medium", loginFor: [sol] });
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(!result.ok);
		assert.match(result.reason, /thinking level medium.*Could not switch back.*stays on github-copilot\/gpt-6\.1-sol/);
		assert.equal(state.model?.id, "gpt-6.1-sol");
	});

	test("restore reports a failed switch back and leaves the thinking level alone", async () => {
		const { state, control } = fakeSession();
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(result.ok);
		state.calls.length = 0;
		state.model = sol;
		control.setModel = async (model) => {
			state.calls.push(`model ${model.id}`);
			return false;
		};
		await assert.rejects(result.restore(), /Could not switch back.*stays on github-copilot\/gpt-6\.1-sol/);
		assert.deepEqual(state.calls, ["model claude-sonnet-5.5"]);
		assert.equal(state.thinking, "medium");
	});

	test("restore reports a session that had no model", async () => {
		const { control } = fakeSession({ start: undefined });
		const result = await applyCoordinatorModel(toSol, control);
		assert.ok(result.ok);
		await assert.rejects(result.restore(), /had no model before \/fleet/);
	});

	test("passes an invalid choice's reason through", async () => {
		const { control } = fakeSession();
		assert.deepEqual(await applyCoordinatorModel({ kind: "invalid", reason: "bad" }, control), { ok: false, reason: "bad" });
	});
});
