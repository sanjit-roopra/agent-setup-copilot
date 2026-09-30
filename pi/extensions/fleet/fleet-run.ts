/**
 * Starting a `/fleet` run and undoing it: the coordinator's tools and model
 * apply for the run, and the session's own come back when it settles.
 *
 * This module has no pi imports so `node --test` can exercise it directly;
 * coordinator.ts connects it to pi.
 */

import { COORDINATOR_MODEL_ENV, messageOf } from "./coordinator-model.ts";

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
					errors.push(messageOf(error));
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

/** What `startCoordinatorRun` needs from pi, so it can be tested without pi. */
export interface FleetRunSession {
	getActiveTools(): string[];
	setActiveTools(tools: string[]): void;
	sendUserMessage(message: string): void;
	notify(message: string, level: "info" | "warning"): void;
}

export interface CoordinatorRun {
	/** Puts back the session's model; from `applyCoordinatorModel`. */
	restoreModel: () => Promise<void>;
	/** The model the session was switched to, if any, for the notice. */
	switchedTo?: string;
	/** The coordinator's tools for the run. */
	tools: string[];
	/** The message that starts the run. */
	message: string;
}

/**
 * Narrow the session to the coordinator's tools and start the run. The steps that undo it are
 * added to `cleanup` before anything that can fail; if starting fails, they run at once and the
 * error is rethrown.
 */
export async function startCoordinatorRun(session: FleetRunSession, cleanup: FleetRunCleanup, run: CoordinatorRun): Promise<void> {
	cleanup.add(run.restoreModel);
	try {
		if (run.switchedTo) {
			session.notify(`/fleet runs the coordinator on ${run.switchedTo}. Set ${COORDINATOR_MODEL_ENV}=session to keep your model.`, "info");
		}
		const toolsBeforeFleet = session.getActiveTools();
		cleanup.add(() => session.setActiveTools(toolsBeforeFleet));
		session.setActiveTools(run.tools);
		session.sendUserMessage(run.message);
	} catch (error) {
		for (const failure of await cleanup.settle()) session.notify(failure, "warning");
		throw error;
	}
}
