/**
 * Which model `/fleet` runs the coordinator on, and switching the session to
 * it and back.
 *
 * The coordinator profile's `model` and `reasoning-effort` apply by default.
 * `PI_FLEET_COORDINATOR_MODEL` overrides them: `session` keeps the session's
 * model, and `provider/model[:thinking]` names another one.
 *
 * This module has no pi imports so `node --test` can exercise it directly;
 * coordinator.ts connects it to pi.
 */

import type { FleetCoordinator } from "./copilot-profiles.ts";

/** pi's thinking levels, lowest first. Mirrors pi's `ThinkingLevel`. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/** A model to switch the session to: `provider/id`, plus a thinking level if one is given. */
export interface ModelTarget {
	provider: string;
	id: string;
	thinking?: ThinkingLevelName;
}

function isThinkingLevel(value: string): value is ThinkingLevelName {
	return (THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Parse `provider/id` or `provider/id:thinking`, e.g. `github-copilot/gpt-6.1-sol:medium`.
 * The id may contain `/` and `:` (`ollama/llama3:8b`); a final `:suffix` is read as the
 * thinking level only if it names one, in any case. Returns `undefined` if there is no
 * provider or no id, or if the text contains whitespace.
 */
export function parsePiModel(spec: string): ModelTarget | undefined {
	const text = spec.trim();
	if (/\s/.test(text)) return undefined;
	const slash = text.indexOf("/");
	const provider = text.slice(0, slash);
	let id = text.slice(slash + 1);
	if (slash <= 0 || provider.includes(":")) return undefined;

	let thinking: ThinkingLevelName | undefined;
	const colon = id.lastIndexOf(":");
	const suffix = id.slice(colon + 1).toLowerCase();
	if (colon !== -1 && isThinkingLevel(suffix)) {
		thinking = suffix;
		id = id.slice(0, colon);
	}
	if (!id) return undefined;
	return thinking ? { provider, id, thinking } : { provider, id };
}

/** Environment variable that overrides the coordinator's model for `/fleet`. */
export const COORDINATOR_MODEL_ENV = "PI_FLEET_COORDINATOR_MODEL";

export type CoordinatorModelChoice =
	| { kind: "session" }
	| { kind: "switch"; target: ModelTarget; source: "profile" | "env" }
	| { kind: "invalid"; reason: string };

function choiceFor(spec: string, source: "profile" | "env", invalidReason: string): CoordinatorModelChoice {
	const target = parsePiModel(spec);
	return target ? { kind: "switch", target, source } : { kind: "invalid", reason: invalidReason };
}

/**
 * Which model `/fleet` runs the coordinator on. `PI_FLEET_COORDINATOR_MODEL=session` keeps the
 * session's model, any other value names the model to use, and without it the coordinator
 * profile's `model` and `reasoning-effort` apply. A profile without a model keeps the session's.
 */
export function coordinatorModelChoice(
	coordinator: FleetCoordinator,
	env: Record<string, string | undefined> = process.env,
): CoordinatorModelChoice {
	const override = env[COORDINATOR_MODEL_ENV]?.trim();
	if (override) {
		if (override.toLowerCase() === "session") return { kind: "session" };
		return choiceFor(
			override,
			"env",
			`${COORDINATOR_MODEL_ENV}=${override} is not "session" or provider/model[:thinking], e.g. github-copilot/claude-opus-5.5:high.`,
		);
	}
	if (!coordinator.model) return { kind: "session" };
	return choiceFor(coordinator.model, "profile", `The coordinator profile's model ${coordinator.model} cannot be used in pi.`);
}

/** What `applyCoordinatorModel` needs from pi, so it can be tested without pi. */
export interface SessionModelControl<M> {
	currentModel(): M | undefined;
	currentThinking(): ThinkingLevelName;
	find(provider: string, id: string): M | undefined;
	setModel(model: M): Promise<boolean>;
	setThinking(level: ThinkingLevelName): void;
}

export type ApplyModelResult =
	| { ok: true; switchedTo?: string; restore: () => Promise<void> }
	| { ok: false; reason: string };

const OVERRIDE_HINT = `Set ${COORDINATOR_MODEL_ENV}=session to keep your session's model, or name another model.`;

/**
 * Switch the session to the chosen coordinator model. On success, `restore` puts back the model
 * and thinking level the session had before, and throws if it cannot, naming the model the
 * session stays on. If the switch fails part-way, the session is put back before this returns.
 */
export async function applyCoordinatorModel<M>(choice: CoordinatorModelChoice, control: SessionModelControl<M>): Promise<ApplyModelResult> {
	if (choice.kind === "session") return { ok: true, restore: async () => {} };
	if (choice.kind === "invalid") return { ok: false, reason: choice.reason };

	const { target } = choice;
	const name = `${target.provider}/${target.id}`;
	const model = control.find(target.provider, target.id);
	if (!model) return { ok: false, reason: `Model ${name} not found. Run \`pi update --models\`, or check /model. ${OVERRIDE_HINT}` };

	const previousModel = control.currentModel();
	const previousThinking = control.currentThinking();
	if (!(await control.setModel(model))) {
		return { ok: false, reason: `Model ${name} has no login configured. Run /login. ${OVERRIDE_HINT}` };
	}

	const restore = async () => {
		if (previousModel === undefined) throw new Error(`The session had no model before /fleet, so it stays on ${name}.`);
		if (!(await control.setModel(previousModel))) {
			throw new Error(`Could not switch back to the session's model (no login), so the session stays on ${name}.`);
		}
		control.setThinking(previousThinking);
	};

	if (target.thinking) {
		try {
			control.setThinking(target.thinking);
		} catch (error) {
			await restore().catch(() => {});
			return { ok: false, reason: `Could not set thinking level ${target.thinking} on ${name}: ${String(error)}` };
		}
	}
	return { ok: true, switchedTo: target.thinking ? `${name}:${target.thinking}` : name, restore };
}

/**
 * The steps that undo a `/fleet` run (restoring tools and model), run once when the run settles.
 * A new run waits for the previous run's steps to finish, so it never captures the coordinator's
 * state as the session's own or has its model changed under it.
 */
export class FleetRunCleanup {
	private steps: Array<() => void | Promise<void>> = [];
	private running: Promise<string[]> | undefined;

	/** Add a step. Steps run in reverse order of adding. */
	add(step: () => void | Promise<void>): void {
		this.steps.push(step);
	}

	/** Whether a run has steps that have not run yet. */
	get pending(): boolean {
		return this.steps.length > 0;
	}

	/**
	 * Run the pending steps once, in reverse order, and wait for any cleanup already running.
	 * Resolves to the messages of steps that failed; a failed step does not stop the others.
	 */
	settle(): Promise<string[]> {
		if (this.steps.length === 0) return this.running ?? Promise.resolve([]);
		const steps = this.steps.reverse();
		this.steps = [];
		const previous = this.running ?? Promise.resolve([]);
		const run = (async () => {
			await previous;
			const errors: string[] = [];
			for (const step of steps) {
				try {
					await step();
				} catch (error) {
					errors.push(error instanceof Error ? error.message : String(error));
				}
			}
			return errors;
		})();
		this.running = run;
		void run.finally(() => {
			if (this.running === run) this.running = undefined;
		});
		return run;
	}
}
