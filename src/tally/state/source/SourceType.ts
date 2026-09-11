import type {
	AnyReplicationDefinition,
	ReplicationDefinition,
} from "../../replication/ReplicationDefinition.js";
import {
	resolveDuplicatePolicy,
	type DuplicatePolicy,
	type ResolvedDuplicatePolicy,
} from "../duplication/DuplicatePolicy.js";
import type { AnyDuplicableType, DuplicableType } from "../duplication/DuplicationCandidate.js";
import { registerNamed, type Registrable, type Registry } from "../Registrable.js";
import type { StateTypeDefinition } from "../StateTypeDefinition.js";
import type { Source } from "./Source.js";
import type { SourceContribution } from "./SourceContribution.js";

export interface SourceTypeDefinition<TData> extends StateTypeDefinition<TData> {
	/**
	 * Defines order of modifier resolution.
	 * Lower priorities resolve before higher priorities.
	 */
	readonly priority: number;
	/**
	 * Specifies the behavior when a Source is added to an AgentState with an
	 * existing same type.
	 *
	 * Defaults to "allow" behavior.
	 *
	 * @see {@link DuplicatePolicy}
	 */
	readonly duplication?: DuplicatePolicy<Source<TData>, TData>;
	/**
	 * Returns the modifiers for a given data that is passed to the Source.
	 */
	contribute(data: TData): SourceContribution;
	/**
	 * Enables replication and specifies serde logic.
	 */
	readonly replication?: ReplicationDefinition<TData> | undefined;
}

export interface AnySourceType extends AnyDuplicableType {
	readonly name: string;
	readonly priority: number;
	readonly duplication: ResolvedDuplicatePolicy<Source, unknown>;
	readonly replication?: AnyReplicationDefinition | undefined;
	dataEquals(a: unknown, b: unknown): boolean;
}

export class SourceType<TData>
	implements AnySourceType, Registrable, DuplicableType<Source<TData>, TData>
{
	public readonly name: string;
	public readonly priority: number;
	public readonly duplication: ResolvedDuplicatePolicy<Source<TData>, TData>;
	public readonly replication?: ReplicationDefinition<TData> | undefined;

	constructor(private readonly definition: SourceTypeDefinition<TData>) {
		this.name = definition.name;
		this.priority = definition.priority;
		this.duplication = resolveDuplicatePolicy(definition.duplication ?? { policy: "allow" });
		this.replication = definition.replication;
	}

	contribute(data: TData): SourceContribution {
		return this.definition.contribute(data);
	}

	register(registry: Registry): void {
		registerNamed(registry.sources, this, "source");
	}

	dataEquals(a: TData, b: TData): boolean {
		return this.definition.dataEquals?.(a, b) ?? Object.is(a, b);
	}
}

/**
 * Defines how Source data contributes Modifiers.
 *
 * SourceTypes are immutable definitions.
 */
export function defineSourceType<TData>(definition: SourceTypeDefinition<TData>) {
	return new SourceType(definition);
}
