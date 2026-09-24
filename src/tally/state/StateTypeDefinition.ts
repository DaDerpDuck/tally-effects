export interface StateTypeDefinition<TData> {
	readonly name: string;
	/**
	 * Determines whether two supplied data are considered equivalent.
	 *
	 * Used to decide whether change callbacks should fire.
	 *
	 * Mutation reentrancy (adding, updating, or destroying a Source or Descriptor)
	 * is unsupported.
	 *
	 * @mutationReentrancy restricted
	 * @requiresMutationGate
	 */
	dataEquals?(a: TData, b: TData): boolean;
}
