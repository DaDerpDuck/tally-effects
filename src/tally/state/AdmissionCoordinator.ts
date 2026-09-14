import type { AdmissionPlan } from "./AdmissionPlan.js";
import type { AdmissionRuntime } from "./AdmissionRuntime.js";
import { AdmissionTransaction } from "./AdmissionTransaction.js";
import type {
	AnyDuplicableType,
	DuplicationCandidate,
} from "./duplication/DuplicationCandidate.js";
import {
	type AnyDuplicationEntry,
	type DuplicationEntry,
	type DuplicationEntryState,
} from "./duplication/DuplicationEntry.js";
import type { DuplicationIndex } from "./duplication/DuplicationIndex.js";
import type {
	DuplicationDecision,
	DuplicationResolver,
} from "./duplication/DuplicationResolver.js";

export interface AdmissionReceipt<T> {
	publish(): T | undefined;
	rollback(): void;
}

export class AdmissionCoordinator {
	private static readonly ZeroScore = () => 0;

	constructor(
		private readonly index: DuplicationIndex,
		private readonly resolver: DuplicationResolver
	) {}

	admit<
		TData,
		TCandidate extends DuplicationCandidate<TData>,
		TRuntime extends AdmissionRuntime<TData>,
	>(plan: AdmissionPlan<TData, TCandidate, TRuntime>): AdmissionReceipt<TCandidate> | undefined {
		const preflightDecision = this.resolver.preflight(plan, this.domainOf(plan.type));
		if (preflightDecision) {
			if (preflightDecision.action === "ignore") return;
			if (preflightDecision.action === "reconcile") {
				const targetState = preflightDecision.target.state;
				if (targetState.kind === "pending") {
					targetState.admission.deferReconciliation((candidate) =>
						preflightDecision.reconcile(candidate)
					);
				} else if (targetState.kind === "live") {
					preflightDecision.reconcile(targetState.candidate);
				}
				return;
			}
		}

		const transaction = new AdmissionTransaction(plan, this.index);

		// eslint-disable-next-line prefer-const
		let entry!: DuplicationEntry<TData, TCandidate, TRuntime>;

		const policy = plan.type.duplication;
		const score =
			policy.kind === "group"
				? () => {
						const state = entry.state;

						if (state.kind === "pending") {
							return policy.rank(state.admission.pendingCandidate().get());
						}

						if (state.kind === "live") {
							return policy.rank(state.candidate.get());
						}

						throw new Error("Cannot rank a removed duplication entry");
					}
				: AdmissionCoordinator.ZeroScore;

		entry = this.index.reserve(this.domainOf(plan.type), plan.key, transaction, score);
		transaction.markReserved(entry);

		try {
			transaction.beginDecision();
			const initialDecision = preflightDecision ?? this.resolver.decide(entry);
			if (transaction.isTerminal()) return;
			if (initialDecision.action !== "add") {
				this.finishNonAddDecision(transaction, initialDecision);
				return;
			}

			const initialBasis = this.index.basis(entry.domain, entry.key);
			transaction.beginPreparing();
			const runtime = transaction.createRuntime();
			if (!runtime) return;
			transaction.discardPlan();

			transaction.drainReconciliations();
			if (transaction.isTerminal()) return;

			runtime.prepare();
			transaction.drainReconciliations();
			if (transaction.isTerminal()) return;

			const finalDecision =
				initialDecision.evict.length === 0 && this.index.isCurrent(initialBasis)
					? initialDecision
					: this.resolver.decide(entry);
			if (transaction.isTerminal()) return;
			if (finalDecision.action !== "add") {
				this.finishNonAddDecision(transaction, finalDecision);
				return;
			}

			const oldStates = this.unlinkEvictions(finalDecision.evict);
			this.destroyEvictions(oldStates);
			if (transaction.isTerminal()) return;

			runtime.install();
			if (transaction.isTerminal()) return;
			transaction.markInstalled();

			transaction.beginAnnouncing();

			const receipt: AdmissionReceipt<TCandidate> = {
				publish: () => {
					if (transaction.isTerminal()) return;
					try {
						runtime.announceAdded();
						if (transaction.isTerminal()) return;

						runtime.markLive(() => this.index.unlink(entry));
						this.index.activate(entry, runtime);
						transaction.complete();

						return runtime.instance as TCandidate;
					} catch (e) {
						transaction.cancel();
						throw e;
					}
				},
				rollback: () => {
					transaction.cancel();
				},
			};

			return receipt;
		} catch (e) {
			transaction.cancel();
			throw e;
		}
	}

	private finishNonAddDecision<
		TData,
		TCandidate extends DuplicationCandidate<TData>,
		TRuntime extends AdmissionRuntime<TData>,
	>(
		transaction: AdmissionTransaction<TData, TCandidate, TRuntime>,
		decision: DuplicationDecision<TData, TCandidate, TRuntime>
	) {
		if (decision.action === "add")
			throw new Error("An add decision cannot be completed as a non-add decision");
		if (decision.action === "ignore") {
			transaction.cancel();
			return;
		}
		if (decision.action === "reconcile") {
			transaction.cancel();
			const targetState = decision.target.state;
			if (targetState.kind === "pending") {
				targetState.admission.deferReconciliation((candidate) =>
					decision.reconcile(candidate)
				);
			} else if (targetState.kind === "live") {
				decision.reconcile(targetState.candidate);
			}
			return;
		}
	}

	private unlinkEvictions(
		evictions: readonly AnyDuplicationEntry[]
	): Set<
		DuplicationEntryState<unknown, DuplicationCandidate<unknown>, AdmissionRuntime<unknown>>
	> {
		const oldStates = new Set<
			DuplicationEntryState<unknown, DuplicationCandidate<unknown>, AdmissionRuntime<unknown>>
		>();
		for (const entry of evictions) {
			const typedEntry = entry as DuplicationEntry<
				unknown,
				DuplicationCandidate<unknown>,
				AdmissionRuntime<unknown>
			>;
			oldStates.add(typedEntry.state);
			this.index.unlink(typedEntry);
		}
		return oldStates;
	}

	private destroyEvictions(
		oldStates: Set<
			DuplicationEntryState<unknown, DuplicationCandidate<unknown>, AdmissionRuntime<unknown>>
		>
	) {
		for (const state of oldStates) {
			if (state.kind === "live") state.candidate.destroy();
			else if (state.kind === "pending") state.admission.cancel();
		}
	}

	private domainOf(type: AnyDuplicableType): object {
		return type.duplication.kind === "group" ? type.duplication.group : type;
	}
}
