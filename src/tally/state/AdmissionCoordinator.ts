import type { AgentMutationGate } from "../core/AgentMutationGate.js";
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
	commit(): void;
	emitAdded(): T | undefined;
	rollback(): void;
}

export class AdmissionCoordinator {
	private static readonly ZeroScore = () => 0;

	constructor(
		private readonly index: DuplicationIndex,
		private readonly resolver: DuplicationResolver,
		private readonly mutationGate: AgentMutationGate
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
			policy.policy === "group"
				? () => {
						const state = entry.state;

						if (state.kind === "pending") {
							return this.mutationGate.evaluate("duplication-policy-rank", () =>
								policy.rank(state.admission.pendingCandidate().get())
							);
						}

						if (state.kind === "live") {
							return this.mutationGate.evaluate("duplication-policy-rank", () =>
								policy.rank(state.candidate.get())
							);
						}

						throw new Error("Cannot rank a removed duplication entry");
					}
				: AdmissionCoordinator.ZeroScore;

		entry = this.index.reserve(this.domainOf(plan.type), plan.key, transaction, score);
		transaction.markReserved(entry);

		try {
			transaction.beginDecision();
			const initialDecision = preflightDecision ?? this.resolver.decide(entry);
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

			const finalDecision =
				initialDecision.evict.length === 0 && this.index.isCurrent(initialBasis)
					? initialDecision
					: this.resolver.decide(entry);
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

			const receipt: AdmissionReceipt<TCandidate> = {
				commit: () => {
					if (transaction.isTerminal()) return;
					this.index.activate(entry, runtime);
					runtime.markLive(() => this.index.unlink(entry));
					transaction.complete();
				},
				emitAdded: () => {
					if (!runtime.isLive()) return;
					runtime.announceAdded();
					return runtime.isLive() ? (runtime.instance as TCandidate) : undefined;
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
		const errors: unknown[] = [];
		for (const state of oldStates) {
			try {
				if (state.kind === "live") state.candidate.destroy();
				else if (state.kind === "pending") state.admission.cancel();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0) {
			const first = errors[0];
			const message = first instanceof Error ? first.message : "Failed to destroy evictions";
			throw new AggregateError(errors, message);
		}
	}

	private domainOf(type: AnyDuplicableType): object {
		return type.duplication.policy === "group" ? type.duplication.group : type;
	}
}
