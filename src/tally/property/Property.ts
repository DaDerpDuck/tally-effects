import type { AnyModifier, Modifier } from "../modifier/Modifier.js";

export interface AnyProperty {
	readonly name: string;
	readonly defaultValue: unknown;
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	valueEquals(a: unknown, b: unknown): boolean;
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	resolve(base: unknown, modifiers: readonly AnyModifier[]): unknown;
}

/**
 * Represents a value that can be resolved from a default value and an ordered
 * collection of Modifiers.
 *
 * Properties are immutable definitions. AgentState cache the currently
 * resolved value for each Property they evaluate.
 *
 * Properties do not store per-agent state themselves and are reusable definitions.
 * Each AgentState resolves and caches its own value for a Property.
 *
 * If {@link resolve} or {@link valueEquals} throws, AgentState reports the failure,
 * retains its last successful cache, and retries resolution after a later mutation.
 */
export interface Property<T, TModifier extends Modifier<T> = Modifier<T>> extends AnyProperty {
	readonly name: string;
	readonly defaultValue: T;
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	valueEquals(a: T, b: T): boolean;
	/**
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	resolve(base: T, modifiers: readonly TModifier[]): T;
}
