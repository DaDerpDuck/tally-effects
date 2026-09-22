export type DuplicationReplaceSelectors = "oldest" | "newest" | "lowest" | "highest";

export type DuplicationGroupDefinition =
	| {
			readonly policy: "ignore";
			readonly maxStack?: number;
			readonly selector?: undefined;
	  }
	| {
			readonly policy: "replace";
			readonly maxStack?: undefined;
			readonly selector?: undefined;
	  }
	| {
			readonly policy: "replace";
			readonly maxStack: number;
			readonly selector: DuplicationReplaceSelectors;
	  };

interface DuplicationGroupOptions<T> {
	/**
	 * Returns the ordering score used by this group.
	 *
	 * Mutation reentrancy (adding, updating, or destroying a Source or Descriptor)
	 * is unsupported.
	 */
	rank(data: T): number;
	/**
	 * Decides whether an incoming score replaces an existing score.
	 *
	 * Mutation reentrancy (adding, updating, or destroying a Source or Descriptor)
	 * is unsupported.
	 */
	replaceIf(existingRank: number, incomingRank: number): boolean;
}

export interface DuplicationGroupMember<T> {
	readonly group: DuplicationGroup;
	/**
	 * Returns the ordering score used by this group.
	 *
	 * Mutation reentrancy (adding, updating, or destroying a Source or Descriptor)
	 * is unsupported.
	 */
	rank(data: T): number;
	/**
	 * Decides whether an incoming score replaces an existing score.
	 *
	 * Mutation reentrancy (adding, updating, or destroying a Source or Descriptor)
	 * is unsupported.
	 */
	replaceIf(existingRank: number, incomingRank: number): boolean;
}

export class DuplicationGroup {
	readonly policy: "ignore" | "replace";
	readonly maxStack: number;
	readonly selector: DuplicationReplaceSelectors;

	constructor(private readonly definition: DuplicationGroupDefinition) {
		if (definition.policy !== "ignore" && definition.policy !== "replace")
			throw new Error("Invalid duplication group policy");

		const { maxStack, selector } = definition;
		if (definition.policy === "ignore" && selector !== undefined)
			throw new Error("ignore groups cannot specify a selector");
		if (definition.policy === "replace" && maxStack !== undefined && selector === undefined)
			throw new Error("replace groups with maxStack must specify a selector");
		if (
			selector !== undefined &&
			selector !== "highest" &&
			selector !== "lowest" &&
			selector !== "newest" &&
			selector !== "oldest"
		)
			throw new Error(`Invalid selector "${selector}"`);

		this.policy = definition.policy;
		this.maxStack = maxStack ?? 1;
		this.selector = selector ?? "oldest";
		if (!Number.isSafeInteger(this.maxStack) || this.maxStack < 0)
			throw new Error("maxStack must be a nonnegative safe integer");
	}

	member<T>(options: Partial<DuplicationGroupOptions<T>> = {}): DuplicationGroupMember<T> {
		const _options: DuplicationGroupOptions<T> = {
			rank: options.rank ?? (() => 0),
			replaceIf: options.replaceIf ?? (() => true),
		};
		return {
			group: this,
			rank: _options.rank,
			replaceIf: _options.replaceIf,
		};
	}
}

export function defineDuplicationGroup(definition: DuplicationGroupDefinition) {
	return new DuplicationGroup(definition);
}
