import type { Modifier } from "../modifier/Modifier.js";

/**
 * Defines a Property's default value, equality behavior, and resolution logic.
 */
export interface PropertyDefinition<TValue, TModifier extends Modifier<TValue> = Modifier<TValue>> {
	readonly name: string;
	/** Base value for a Property that further Modifiers can affect off of. */
	readonly defaultValue: TValue;
	/**
	 * Determines whether two resolved values are considered equivalent.
	 *
	 * Used to decide whether property-change callbacks should fire.
	 *
	 * Mutation reentrancy (adding, updating, or destroying a Source or Descriptor)
	 * is unsupported.
	 *
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	valueEquals?(a: TValue, b: TValue): boolean;
	/**
	 * Resolves the final Property value from the base value and ordered Modifiers.
	 *
	 * If omitted, the Property implementation's default resolution behavior is used.
	 *
	 * Mutation reentrancy (adding, updating, or destroying a Source or Descriptor)
	 * is unsupported.
	 *
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	resolve?: (base: TValue, modifiers: readonly TModifier[]) => TValue;
}

type OptionalKeys<T> = {
	[K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];
type RequiredOptionals<T> = Required<Pick<T, OptionalKeys<T>>>;

export type ResolvedPropertyDefinition<TValue, TModifier extends Modifier<TValue>> = Required<
	PropertyDefinition<TValue, TModifier>
>;
export type DefaultPropertyDefinition<
	TValue,
	TModifier extends Modifier<TValue>,
> = RequiredOptionals<PropertyDefinition<TValue, TModifier>>;

export function resolvePropertyDefinition<TValue, TModifier extends Modifier<TValue>>(
	definition: PropertyDefinition<TValue, TModifier>,
	defaults: DefaultPropertyDefinition<TValue, TModifier>
): ResolvedPropertyDefinition<TValue, TModifier> {
	return {
		name: definition.name,
		defaultValue: definition.defaultValue,
		resolve: definition.resolve ?? defaults.resolve,
		valueEquals: definition.valueEquals ?? defaults.valueEquals,
	};
}
