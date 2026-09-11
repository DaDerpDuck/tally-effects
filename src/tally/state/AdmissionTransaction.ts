import type { AdmissionPlan } from "./AdmissionPlan.js";
import type { AdmissionRuntime } from "./AdmissionRuntime.js";
import type {
	AnyDuplicableType,
	DuplicationCandidate,
} from "./duplication/DuplicationCandidate.js";
import type { DuplicationEntry } from "./duplication/DuplicationEntry.js";
import type { DuplicationIndex } from "./duplication/DuplicationIndex.js";

type AdmissionState =
	| "created" // transaction exists but is not visible in the index
	| "reserved" // has a pending index entry
	| "deciding" // evaluating duplication policy (reentrancy possible from rank/replaceIf functions)
	| "preparing" // plan is creating runtime and public instance (reentrancy possible from contribution/binding)
	| "installed" // runtime registered in manager's internal collections
	| "announcing" // publishing added notification (reentrancy possible from added listeners)
	| "completed" // admission succeeded, entry is now live
	| "cancelled"; // admission will not produce a live entry

export interface AdmissionLease {
	isTerminal(): boolean;
	cancel(): void;
}

export interface PendingCandidateView<TData> {
	readonly kind: "pending";
	readonly type: AnyDuplicableType;

	get(): TData;
}

export class AdmissionTransaction<
	TData,
	TCandidate extends DuplicationCandidate<TData>,
	TRuntime extends AdmissionRuntime<TData>,
> implements AdmissionLease {
	private state: AdmissionState = "created";
	private entry: DuplicationEntry<TData, TCandidate, TRuntime> | undefined;
	private runtime: TRuntime | undefined;
	private plan: AdmissionPlan<TData, TCandidate, TRuntime> | undefined;

	private readonly pendingReconciliations: Array<(candidate: TCandidate) => void> = [];
	private readonly pendingCandidateView: PendingCandidateView<TData>;

	constructor(
		plan: AdmissionPlan<TData, TCandidate, TRuntime>,
		private readonly index: DuplicationIndex
	) {
		this.plan = plan;
		this.pendingCandidateView = {
			kind: "pending",
			type: plan.type,
			get: () => {
				if (this.runtime) return this.runtime.instance.get();
				if (this.plan) return this.plan.data;
				throw new Error("Admission is no longer pending");
			},
		};
	}

	pendingCandidate(): PendingCandidateView<TData> {
		return this.pendingCandidateView;
	}

	markReserved(entry: DuplicationEntry<TData, TCandidate, TRuntime>) {
		if (this.state !== "created")
			throw new Error("Cannot mark as reserve from a state other than created");
		this.entry = entry;
		this.state = "reserved";
	}

	beginDecision() {
		if (this.state !== "reserved")
			throw new Error("Cannot begin decision from a state other than reserved");
		this.state = "deciding";
	}

	beginPreparing() {
		if (this.state !== "deciding")
			throw new Error("Cannot begin preparing from a state other than deciding");
		this.state = "preparing";
	}

	markInstalled() {
		if (this.state !== "preparing")
			throw new Error("Cannot install from a state other than preparing");
		this.state = "installed";
	}

	beginAnnouncing() {
		if (this.state !== "installed")
			throw new Error("Cannot announce from a state other than installed");
		this.state = "announcing";
	}

	complete() {
		if (!this.runtime || !this.entry) throw new Error("Cannot complete without a runtime");
		if (this.isTerminal()) return;

		this.state = "completed";

		// Coordinator activates entry and calls runtime.markLive()
		this.pendingReconciliations.length = 0;
		this.plan = undefined;
		this.runtime = undefined;
	}

	createRuntime(): TRuntime | undefined {
		if (this.state !== "preparing") throw new Error("Expected a preparing transaction");
		const plan = this.plan;
		if (!plan) return;

		const runtime = plan.createRuntime(this);
		if (!runtime) {
			this.cancel();
			return;
		}

		this.runtime = runtime;
		return runtime;
	}

	cancel() {
		if (this.isTerminal()) return;
		this.state = "cancelled";

		if (this.entry) this.index.unlink(this.entry);
		this.runtime?.rollbackAdmission();

		this.pendingReconciliations.length = 0;
		this.runtime = undefined;
		this.plan = undefined;
	}

	discardPlan() {
		this.plan = undefined;
	}

	deferReconciliation(callback: (candidate: TCandidate) => void) {
		if (this.isTerminal()) return;

		if (this.runtime) {
			callback(this.runtime.instance as TCandidate);
			return;
		}

		this.pendingReconciliations.push(callback);
	}

	drainReconciliations() {
		const runtime = this.runtime;
		if (!runtime || this.isTerminal()) return;

		while (this.pendingReconciliations.length > 0 && !this.isTerminal()) {
			this.pendingReconciliations.shift()!(runtime.instance as TCandidate);
		}
	}

	isTerminal() {
		return this.state === "completed" || this.state === "cancelled";
	}
}
