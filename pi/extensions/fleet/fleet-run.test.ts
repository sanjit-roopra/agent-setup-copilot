import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type FleetRunSession, FleetRunCleanup, settleAndReport, startCoordinatorRun } from "./fleet-run.ts";

/** Wait until `condition` holds, letting pending promises run in between. */
async function until(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
	assert.ok(condition(), "condition never held");
}

describe("FleetRunCleanup", () => {
	test("runs the steps once, in reverse order", async () => {
		const cleanup = new FleetRunCleanup();
		const ran: string[] = [];
		cleanup.add(() => void ran.push("model"));
		cleanup.add(() => void ran.push("tools"));
		assert.deepEqual(ran, []);
		assert.deepEqual(await cleanup.settle(), []);
		assert.deepEqual(await cleanup.settle(), []);
		assert.deepEqual(ran, ["tools", "model"]);
	});

	test("reports failed steps, sync or async, Error or not, and still runs the others", async () => {
		const cleanup = new FleetRunCleanup();
		const ran: string[] = [];
		cleanup.add(() => void ran.push("model"));
		cleanup.add(() => Promise.reject(new Error("async failed")));
		cleanup.add(() => {
			throw "string failed";
		});
		cleanup.add(() => {
			throw new Error("tools failed");
		});
		assert.deepEqual(await cleanup.settle(), ["tools failed", "string failed", "async failed"]);
		assert.deepEqual(ran, ["model"]);
	});

	test("a settle during a running cleanup waits for it", async () => {
		const cleanup = new FleetRunCleanup();
		const events: string[] = [];
		let finishRestore: () => void = () => {};
		cleanup.add(
			() =>
				new Promise<void>((resolve) => {
					events.push("restore started");
					finishRestore = () => {
						events.push("restore finished");
						resolve();
					};
				}),
		);
		const first = cleanup.settle();
		const second = cleanup.settle().then(() => events.push("next run may start"));
		await until(() => events.includes("restore started"));
		assert.deepEqual(events, ["restore started"]);
		finishRestore();
		await Promise.all([first, second]);
		assert.deepEqual(events, ["restore started", "restore finished", "next run may start"]);
	});

	test("reports a failed step only to the caller that ran it", async () => {
		const cleanup = new FleetRunCleanup();
		let started = false;
		let finish: () => void = () => {};
		cleanup.add(() => {
			started = true;
			return new Promise<void>((_, reject) => (finish = () => reject(new Error("restore failed"))));
		});
		const first = cleanup.settle();
		const second = cleanup.settle();
		await until(() => started);
		finish();
		assert.deepEqual(await Promise.all([first, second]), [["restore failed"], []]);
	});

	test("settleAndReport shows each failed step as a warning", async () => {
		const cleanup = new FleetRunCleanup();
		cleanup.add(() => {
			throw new Error("tools failed");
		});
		const shown: string[] = [];
		await settleAndReport(cleanup, (message, level) => shown.push(`${level} ${message}`));
		assert.deepEqual(shown, ["warning tools failed"]);
	});

	test("steps added during a running cleanup run after it", async () => {
		const cleanup = new FleetRunCleanup();
		const events: string[] = [];
		let started = false;
		let finishFirst: () => void = () => {};
		cleanup.add(() => {
			started = true;
			return new Promise<void>((resolve) => (finishFirst = resolve)).then(() => void events.push("first run restored"));
		});
		const first = cleanup.settle();
		cleanup.add(() => void events.push("second run restored"));
		const second = cleanup.settle();
		await until(() => started);
		assert.deepEqual(events, []);
		finishFirst();
		await Promise.all([first, second]);
		assert.deepEqual(events, ["first run restored", "second run restored"]);
	});
});

describe("startCoordinatorRun", () => {
	const COORDINATOR_TOOLS = ["fleet"];
	/** A session with tools a and b that records every call; `failOn` makes that call throw. */
	function fakeSession(failOn?: "getActiveTools" | "setActiveTools" | "sendUserMessage") {
		const state = { tools: ["a", "b"], calls: [] as string[] };
		const fail = (call: string) => {
			if (call === failOn) throw new Error(`${call} failed`);
		};
		const session: FleetRunSession = {
			getActiveTools: () => {
				fail("getActiveTools");
				return [...state.tools];
			},
			setActiveTools: (tools) => {
				state.calls.push(`tools ${tools.join(",")}`);
				// Fail only when narrowing to the coordinator's tools, so restoring still works.
				if (tools === COORDINATOR_TOOLS) fail("setActiveTools");
				state.tools = tools;
			},
			sendUserMessage: (message) => {
				state.calls.push(`send ${message}`);
				fail("sendUserMessage");
			},
			notify: (message, level) => state.calls.push(`${level} ${message}`),
		};
		return { state, session };
	}
	const run = (calls: string[]) => ({
		restoreModel: async () => void calls.push("model restored"),
		switchedTo: "github-copilot/gpt-6.1-sol:medium",
		tools: COORDINATOR_TOOLS,
		message: "go",
	});

	test("says which model it switched to, narrows the tools, and starts the run", async () => {
		const { state, session } = fakeSession();
		const cleanup = new FleetRunCleanup();
		await startCoordinatorRun(session, cleanup, run(state.calls));
		assert.deepEqual(state.calls, [
			"info /fleet runs the coordinator on github-copilot/gpt-6.1-sol:medium. Set PI_FLEET_COORDINATOR_MODEL=session to keep your model.",
			"tools fleet",
			"send go",
		]);
		assert.deepEqual(state.tools, ["fleet"]);
	});

	test("no notice when the session keeps its model", async () => {
		const { state, session } = fakeSession();
		await startCoordinatorRun(session, new FleetRunCleanup(), { ...run(state.calls), switchedTo: undefined });
		assert.deepEqual(state.calls, ["tools fleet", "send go"]);
	});

	test("settling puts back the tools, then the model", async () => {
		const { state, session } = fakeSession();
		const cleanup = new FleetRunCleanup();
		await startCoordinatorRun(session, cleanup, run(state.calls));
		state.calls.length = 0;
		assert.deepEqual(await cleanup.settle(), []);
		assert.deepEqual(state.calls, ["tools a,b", "model restored"]);
		assert.deepEqual(state.tools, ["a", "b"]);
	});

	const undone: Record<"getActiveTools" | "setActiveTools" | "sendUserMessage", string[]> = {
		getActiveTools: ["model restored"],
		setActiveTools: ["tools fleet", "tools a,b", "model restored"],
		sendUserMessage: ["tools fleet", "send go", "tools a,b", "model restored"],
	};
	for (const [failOn, calls] of Object.entries(undone) as Array<[keyof typeof undone, string[]]>) {
		test(`undoes the run at once, tools then model, and rethrows when ${failOn} fails`, async () => {
			const { state, session } = fakeSession(failOn);
			const cleanup = new FleetRunCleanup();
			await assert.rejects(startCoordinatorRun(session, cleanup, { ...run(state.calls), switchedTo: undefined }), new RegExp(`${failOn} failed`));
			assert.deepEqual(state.calls, calls);
			assert.deepEqual(state.tools, ["a", "b"]);
			assert.deepEqual(await cleanup.settle(), [], "nothing left to undo");
		});
	}

	test("warns about an undo step that fails while undoing a failed start", async () => {
		const { state, session } = fakeSession("sendUserMessage");
		const cleanup = new FleetRunCleanup();
		const failingRestore = { ...run(state.calls), switchedTo: undefined, restoreModel: () => Promise.reject(new Error("no login")) };
		await assert.rejects(startCoordinatorRun(session, cleanup, failingRestore), /sendUserMessage failed/);
		assert.deepEqual(state.calls.at(-1), "warning no login");
	});
});
