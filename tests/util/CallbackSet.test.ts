import { describe, expect, it, vi } from "vitest";
import type { TallyReport, TallyReporter } from "../../src/index.js";
import { CallbackSet } from "../../src/tally/util/CallbackSet.js";

function createCallbacks() {
	const reports: TallyReport[] = [];
	const reporter: TallyReporter = { report: (report) => reports.push(report) };
	const callbacks = new CallbackSet<[]>(reporter, {
		operation: "update",
		event: "source-updated",
	});
	return { callbacks, reports };
}

describe("CallbackSet", () => {
	it("defers subscriptions connected during emission until the next emission", () => {
		const { callbacks } = createCallbacks();
		const later = vi.fn();
		let connected = false;
		callbacks.add(() => {
			if (!connected) {
				connected = true;
				callbacks.add(later);
			}
		});

		callbacks.emit();
		expect(later).not.toHaveBeenCalled();
		callbacks.emit();
		expect(later).toHaveBeenCalledOnce();
	});

	it("skips a pending subscription disconnected before its turn", () => {
		const { callbacks } = createCallbacks();
		const pending = vi.fn();
		let disconnectPending = () => {};
		callbacks.add(() => disconnectPending());
		disconnectPending = callbacks.add(pending);

		callbacks.emit();
		expect(pending).not.toHaveBeenCalled();
	});

	it("does not run a reconnected subscription in the active emission", () => {
		const { callbacks } = createCallbacks();
		const callback = vi.fn();
		let disconnect!: () => void;
		let reconnected = false;
		callbacks.add(() => {
			if (!reconnected) {
				reconnected = true;
				disconnect();
				disconnect = callbacks.add(callback);
			}
		});
		disconnect = callbacks.add(callback);

		callbacks.emit();
		expect(callback).not.toHaveBeenCalled();
		callbacks.emit();
		expect(callback).toHaveBeenCalledOnce();
	});

	it("takes a fresh snapshot for recursive emission", () => {
		const { callbacks } = createCallbacks();
		const calls: string[] = [];
		let recursive = true;
		callbacks.add(() => {
			calls.push("first");
			if (recursive) {
				recursive = false;
				callbacks.emit();
			}
		});
		callbacks.add(() => calls.push("second"));

		callbacks.emit();
		expect(calls).toEqual(["first", "first", "second", "second"]);
	});

	it("reports a failed callback while respecting subscription mutations", () => {
		const { callbacks, reports } = createCallbacks();
		const pending = vi.fn();
		const later = vi.fn();
		const survivor = vi.fn();
		let disconnectPending = () => {};
		callbacks.add(() => {
			disconnectPending();
			callbacks.add(later);
			throw new Error("observer failed");
		});
		disconnectPending = callbacks.add(pending);
		callbacks.add(survivor);

		expect(() => callbacks.emit()).not.toThrow();
		expect(pending).not.toHaveBeenCalled();
		expect(later).not.toHaveBeenCalled();
		expect(survivor).toHaveBeenCalledOnce();
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("observer failed"),
				code: "callback-failed",
				operation: "update",
				event: "source-updated",
			}),
		]);
	});
});
