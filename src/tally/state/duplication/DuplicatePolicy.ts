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
	  };
