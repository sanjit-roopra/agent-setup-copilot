/**
 * The `/fleet <task>` command: run the current session as the `Subagent Fleet`
 * coordinator from `.github/agents/`.
 *
 * Like the Copilot coordinator, the session may only delegate, read, and
 * search while the run lasts. The command narrows the active tools to the
 * coordinator profile's tools and restores the previous tools once the run
 * settles. If the profile's tools cannot be translated, the command refuses to
 * run rather than coordinating with every tool.
 *
 * The run also uses the coordinator profile's model and reasoning effort, and
 * switches back to the session's model and thinking level afterwards.
 * `PI_FLEET_COORDINATOR_MODEL` overrides this: `session` keeps the session's
 * model, and `provider/model[:thinking]` names another one.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents.ts";
import { applyCoordinatorModel, coordinatorModelChoice } from "./coordinator-model.ts";
import { FleetRunCleanup, settleAndReport, startCoordinatorRun } from "./fleet-run.ts";
import { buildCoordinatorMessage, coordinatorRoster, loadRepoFleet, planFleetRun } from "./copilot-profiles.ts";

export function registerFleetCommand(pi: ExtensionAPI): void {
	// Puts back the session's tools and model once a /fleet run settles.
	const cleanup = new FleetRunCleanup();
	pi.on("agent_settled", (_event, ctx) => settleAndReport(cleanup, (message, level) => ctx.ui.notify(message, level)));

	pi.registerCommand("fleet", {
		description: "Coordinate the subagent fleet on a task: /fleet <task>",
		handler: async (args, ctx) => {
			const task = args.trim();
			if (!task) {
				ctx.ui.notify("Usage: /fleet <task>", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Wait for it to finish, then run /fleet again.", "warning");
				return;
			}
			const notify = (message: string, level: "info" | "warning" | "error") => ctx.ui.notify(message, level);
			// Finish undoing the previous run first, so this run starts from the session's own tools and model.
			await settleAndReport(cleanup, notify);

			const fleet = loadRepoFleet();
			for (const warning of fleet.warnings) ctx.ui.notify(warning, "warning");
			const plan = planFleetRun(fleet);
			if (!plan.ok) {
				ctx.ui.notify(plan.reason, "error");
				return;
			}

			// Describe the specialists that will actually run, including user overrides. "user" matches
			// the fleet tool's default agent scope (fleet/index.ts), so the roster names what it resolves.
			const { roster, missing } = coordinatorRoster(plan.coordinator, discoverAgents(ctx.cwd, "user").agents);
			for (const name of missing) ctx.ui.notify(`The coordinator lists ${name}, but no such specialist was found.`, "warning");
			const message = buildCoordinatorMessage(plan.coordinator, roster, task);

			const switched = await applyCoordinatorModel(coordinatorModelChoice(plan.coordinator), {
				currentModel: () => ctx.model,
				currentThinking: () => pi.getThinkingLevel(),
				find: (provider, id) => ctx.modelRegistry.find(provider, id),
				setModel: (model) => pi.setModel(model),
				setThinking: (level) => pi.setThinkingLevel(level),
			});
			if (!switched.ok) {
				notify(switched.reason, "error");
				return;
			}
			await startCoordinatorRun(
				{
					getActiveTools: () => pi.getActiveTools(),
					setActiveTools: (tools) => pi.setActiveTools(tools),
					sendUserMessage: (message) => pi.sendUserMessage(message),
					notify,
				},
				cleanup,
				{
					restoreModel: switched.restore,
					switchedTo: switched.switchedTo,
					tools: plan.tools,
					message,
				},
			);
		},
	});
}
