/**
 * The `/fleet <task>` command: run the current session as the `Subagent Fleet`
 * coordinator from `.github/agents/`.
 *
 * Like the Copilot coordinator, the session may only delegate, read, and
 * search while the run lasts. The command narrows the active tools to the
 * coordinator profile's tools and restores the previous tools once the run
 * settles. If the profile's tools cannot be translated, the command refuses to
 * run rather than coordinating with every tool.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents.ts";
import { buildCoordinatorMessage, coordinatorRoster, loadRepoFleet } from "./copilot-profiles.ts";

export function registerFleetCommand(pi: ExtensionAPI): void {
	// Tools that were active before /fleet narrowed them; restored when the run settles.
	let toolsBeforeFleet: string[] | undefined;
	pi.on("agent_settled", () => {
		if (!toolsBeforeFleet) return;
		pi.setActiveTools(toolsBeforeFleet);
		toolsBeforeFleet = undefined;
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
			const { coordinator } = fleet;
			if (!coordinator) {
				ctx.ui.notify("No Subagent Fleet coordinator profile found.", "error");
				return;
			}
			if (!coordinator.tools || coordinator.tools.length === 0) {
				ctx.ui.notify("The coordinator profile declares no tools pi can use; /fleet will not run.", "error");
				return;
			}

			// Describe the specialists that will actually run, including user overrides.
			const roster = coordinatorRoster(coordinator, discoverAgents(ctx.cwd, "user").agents);
			toolsBeforeFleet ??= pi.getActiveTools();
			pi.setActiveTools(coordinator.tools);
			pi.sendUserMessage(buildCoordinatorMessage(coordinator, roster, task));
		},
	});
}
