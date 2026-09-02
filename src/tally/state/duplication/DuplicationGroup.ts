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
	rank(data: T): number;
	replaceIf(existingRank: number, incomingRank: number): boolean;
}

export interface DuplicationGroupMember<T> {
	readonly group: DuplicationGroup;
	rank(data: T): number;
	replaceIf(existingRank: number, incomingRank: number): boolean;
}

export class DuplicationGroup {
	readonly policy: "ignore" | "replace";
	readonly maxStack: number;
	readonly selector: DuplicationReplaceSelectors;

	constructor(private readonly definition: DuplicationGroupDefinition) {
		this.policy = definition.policy;
		this.maxStack = definition.maxStack ?? 1;
		this.selector = definition.selector || "oldest";
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
