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
import {
	applyCoordinatorModel,
	buildCoordinatorMessage,
	coordinatorModelChoice,
	coordinatorRoster,
	loadRepoFleet,
	planFleetRun,
} from "./copilot-profiles.ts";

export function registerFleetCommand(pi: ExtensionAPI): void {
	// Tools that were active before /fleet narrowed them; restored when the run settles.
	let toolsBeforeFleet: string[] | undefined;
	// Puts back the session's model and thinking level; set while a /fleet run uses another model.
	let restoreModel: (() => Promise<void>) | undefined;
	pi.on("agent_settled", async () => {
		if (toolsBeforeFleet) {
			pi.setActiveTools(toolsBeforeFleet);
			toolsBeforeFleet = undefined;
		}
		if (restoreModel) {
			const restore = restoreModel;
			restoreModel = undefined;
			await restore();
		}
	});

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

			const switched = await applyCoordinatorModel(coordinatorModelChoice(plan.coordinator), {
				currentModel: () => ctx.model,
				currentThinking: () => pi.getThinkingLevel(),
				find: (provider, id) => ctx.modelRegistry.find(provider, id),
				setModel: (model) => pi.setModel(model),
				setThinking: (level) => pi.setThinkingLevel(level),
			});
			if (!switched.ok) {
				ctx.ui.notify(switched.reason, "error");
				return;
			}
			// Keep the first restore if a run is somehow still pending, so the session's own model comes back.
			if (switched.switched) restoreModel ??= switched.restore;
			toolsBeforeFleet ??= pi.getActiveTools();
			pi.setActiveTools(plan.tools);
			pi.sendUserMessage(buildCoordinatorMessage(plan.coordinator, roster, task));
		},
	});
}
