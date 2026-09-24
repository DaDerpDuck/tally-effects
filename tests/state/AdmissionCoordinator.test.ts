import { describe, expect, it, vi } from "vitest";
import { AdmissionCoordinator } from "../../src/tally/state/AdmissionCoordinator.js";
import type { AdmissionPlan } from "../../src/tally/state/AdmissionPlan.js";
import type { AdmissionRuntime } from "../../src/tally/state/AdmissionRuntime.js";
import { AdmissionTransaction } from "../../src/tally/state/AdmissionTransaction.js";
import { AgentMutationGate } from "../../src/tally/core/AgentMutationGate.js";
import type {
	DuplicableType,
	DuplicationCandidate,
} from "../../src/tally/state/duplication/DuplicationCandidate.js";
import { DuplicationGroup } from "../../src/tally/state/duplication/DuplicationGroup.js";
import { DuplicationIndex } from "../../src/tally/state/duplication/DuplicationIndex.js";
import { DuplicationResolver } from "../../src/tally/state/duplication/DuplicationResolver.js";

class TestCandidate implements DuplicationCandidate<number> {
	constructor(
		readonly type: DuplicableType<TestCandidate, number>,
		private readonly data: number,
		private readonly onDestroy: () => void = () => {}
	) {}

	get() {
		return this.data;
	}

	destroy() {
		this.onDestroy();
	}
}

class TestRuntime implements AdmissionRuntime<number> {
	private live = false;
	private destroyed = false;
	announced = false;

	constructor(
		readonly instance: TestCandidate,
		private readonly onAnnounce: () => void = () => {}
	) {}

	prepare() {}
	install() {}
	announceAdded() {
		if (!this.live) throw new Error("Cannot announce before activation");
		this.announced = true;
		this.onAnnounce();
	}
	markLive() {
		this.live = true;
	}
	rollbackAdmission() {
		this.destroyed = true;
	}
	isLive() {
		return this.live && !this.destroyed;
	}
}

function createPlan(
	type: DuplicableType<TestCandidate, number>,
	data: number,
	onDestroy?: () => void,
	onAnnounce?: () => void
): AdmissionPlan<number, TestCandidate, TestRuntime> {
	return {
		type,
		key: undefined,
		data,
		createRuntime: () => new TestRuntime(new TestCandidate(type, data, onDestroy), onAnnounce),
	};
}

function reservePending(
	index: DuplicationIndex,
	domain: object,
	plan: AdmissionPlan<number, TestCandidate, TestRuntime>
) {
	const transaction = new AdmissionTransaction(plan, index);
	const entry = index.reserve(domain, undefined, transaction, () => plan.data);
	transaction.markReserved(entry);
	return entry;
}

function reserveLive(
	index: DuplicationIndex,
	domain: object,
	plan: AdmissionPlan<number, TestCandidate, TestRuntime>
) {
	const transaction = new AdmissionTransaction(plan, index);
	const entry = index.reserve(domain, undefined, transaction, () => plan.data);
	transaction.markReserved(entry);
	transaction.beginDecision();
	transaction.beginPreparing();
	const runtime = transaction.createRuntime()!;
	transaction.markInstalled();
	index.activate(entry, runtime);
	runtime.markLive();
	transaction.complete();
	return runtime.instance;
}

describe("admission coordinator recovery", () => {
	it("activates an entry before its added notification", () => {
		const type: DuplicableType<TestCandidate, number> = {
			duplication: { policy: "allow" },
		};
		const index = new DuplicationIndex();
		const mutationGate = new AgentMutationGate();
		const coordinator = new AdmissionCoordinator(
			index,
			new DuplicationResolver(index, mutationGate),
			mutationGate
		);
		const observedStates: string[] = [];
		const receipt = coordinator.admit(
			createPlan(type, 1, undefined, () => {
				observedStates.push(index.first(type, undefined)?.state.kind ?? "missing");
			})
		)!;

		expect(index.first(type, undefined)?.state.kind).toBe("pending");
		receipt.commit();
		expect(index.first(type, undefined)?.state.kind).toBe("live");
		expect(receipt.emitAdded()).toBeDefined();
		expect(observedStates).toEqual(["live"]);
	});

	it("plans enough grouped evictions to restore an overfull bucket", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		const type: DuplicableType<TestCandidate, number> = {
			duplication: {
				policy: "group",
				group,
				rank: (value) => value,
				replaceIf: () => true,
			},
		};
		const index = new DuplicationIndex();
		const mutationGate = new AgentMutationGate();
		const resolver = new DuplicationResolver(index, mutationGate);

		const first = reservePending(index, group, createPlan(type, 1));
		const second = reservePending(index, group, createPlan(type, 2));
		const incoming = reservePending(index, group, createPlan(type, 3));

		const decision = resolver.decide(incoming);

		expect(decision).toMatchObject({ action: "add" });
		if (decision.action === "add") {
			expect(decision.evict).toHaveLength(2);
			expect(decision.evict).toEqual(expect.arrayContaining([first, second]));
		}
	});

	it("attempts every replacement eviction after an earlier destruction failure", () => {
		const type: DuplicableType<TestCandidate, number> = {
			duplication: { policy: "replace" },
		};
		const index = new DuplicationIndex();
		const mutationGate = new AgentMutationGate();
		const coordinator = new AdmissionCoordinator(
			index,
			new DuplicationResolver(index, mutationGate),
			mutationGate
		);
		const firstDestroy = vi.fn(() => {
			throw new Error("first eviction failed");
		});
		const secondDestroy = vi.fn();

		reserveLive(index, type, createPlan(type, 1, firstDestroy));
		reserveLive(index, type, createPlan(type, 2, secondDestroy));

		expect(() => coordinator.admit(createPlan(type, 3))).toThrow("first eviction failed");
		expect(firstDestroy).toHaveBeenCalledOnce();
		expect(secondDestroy).toHaveBeenCalledOnce();
	});
});
