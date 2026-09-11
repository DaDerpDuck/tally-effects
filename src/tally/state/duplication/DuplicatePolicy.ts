import type { DuplicationGroup, DuplicationGroupMember } from "./DuplicationGroup.js";

/**
 * Specifies the behavior when a state is added to an AgentState with an
 * existing same type.
 *
 * Defaults to "allow" behavior if left unspecified in the state's definition.
 *
 * | Policy        | Definition                                             |
 * | ------------- | ------------------------------------------------------ |
 * | `"allow"`     | Adds the state regardless of existing duplicate types. |
 * | `"ignore"`    | Rejects creation of the state.                         |
 * | `"replace"`   | Destroys the existing state and adds a new state.      |
 * | `"reconcile"` | The `reconcile` method in the policy is called to merge the data. |
 */
export type DuplicatePolicy<TExisting, TData> =
	| {
			readonly policy: "allow" | "ignore" | "replace";
	  }
	| {
			readonly policy: "reconcile";
			reconcile(existing: TExisting, incoming: TData): void;
	  }
	| DuplicationGroupMember<TData>;

export type ResolvedDuplicatePolicy<TExisting, TData> =
	| { readonly kind: "allow" }
	| { readonly kind: "ignore" }
	| { readonly kind: "replace" }
	| { readonly kind: "reconcile"; reconcile(existing: TExisting, incoming: TData): void }
	| {
			readonly kind: "group";
			readonly group: DuplicationGroup;
			rank(data: TData): number;
			replaceIf(existingRank: number, incomingRank: number): boolean;
	  };

export function resolveDuplicatePolicy<TExisting, TData>(
	policy: DuplicatePolicy<TExisting, TData>
): ResolvedDuplicatePolicy<TExisting, TData> {
	if ("policy" in policy) {
		if (policy.policy === "reconcile") {
			return {
				kind: "reconcile",
				reconcile: policy.reconcile,
			};
		} else {
			return {
				kind: policy.policy,
			};
		}
	} else {
		return {
			kind: "group",
			group: policy.group,
			rank: policy.rank,
			replaceIf: policy.replaceIf,
		};
	}
}
