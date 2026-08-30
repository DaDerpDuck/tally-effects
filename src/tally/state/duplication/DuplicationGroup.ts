const DuplicationGroupSymbol: unique symbol = Symbol("duplicationGroup");
export function isDuplicationGroup(o: object): o is DuplicationGroup {
	return DuplicationGroupSymbol in o;
}

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
			readonly selector: "oldest" | "newest" | "lowest" | "highest";
	  };

export class DuplicationGroup<T = unknown> {
	private readonly [DuplicationGroupSymbol] = true;
	readonly policy: "ignore" | "replace";
	readonly maxStack: number;
	readonly selector: "lowest" | "highest";

	constructor(
		private readonly definition: DuplicationGroupDefinition,
		private ranker = (data: T, index: number) => index
	) {
		this.policy = definition.policy;
		this.maxStack = definition.maxStack ?? 1;

		if (!definition.selector) this.selector = "lowest";
		else if (definition.selector === "oldest") this.selector = "lowest";
		else if (definition.selector === "newest") this.selector = "highest";
		else this.selector = definition.selector;
	}

	rank(data: T, index: number): number {
		return this.ranker(data, index);
	}

	// Somehow, doing this makes data resolve to the right type inside a SourceTypeDefinition
	byRank<V extends T>(callback: (data: V, index: number) => number): DuplicationGroup<V> {
		return new DuplicationGroup(this.definition, callback);
	}
}

export function defineDuplicationGroup(definition: DuplicationGroupDefinition) {
	return new DuplicationGroup(definition);
}
