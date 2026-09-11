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
import type { SourceType } from "../source/SourceType.js";
import type { StateTypeDefinition } from "../StateTypeDefinition.js";
import type { AnyDescriptor, Descriptor } from "./Descriptor.js";

export interface DescriptorTypeDefinition<
	TDescriptorData,
	TSourceData,
> extends StateTypeDefinition<TDescriptorData> {
	/**
	 * Specifies the behavior when a Descriptor is added to an AgentState with an
	 * existing same type.
	 *
	 * Defaults to "allow" behavior.
	 *
	 * @see {@link DuplicatePolicy}
	 */
	readonly duplication?: DuplicatePolicy<
		Descriptor<TDescriptorData, TSourceData>,
		TDescriptorData
	>;
	/**
	 * The SourceType that this Descriptor will be creating.
	 */
	readonly source: SourceType<TSourceData>;
	/**
	 * Enables replication and specifies serde logic.
	 */
	readonly replication?: ReplicationDefinition<TDescriptorData> | undefined;
}

export interface AnyDescriptorType extends AnyDuplicableType {
	readonly name: string;
	readonly duplication: ResolvedDuplicatePolicy<AnyDescriptor, unknown>;
	readonly replication?: AnyReplicationDefinition | undefined;
	dataEquals(a: unknown, b: unknown): boolean;
}

export class DescriptorType<TDescriptorData, TSourceData>
	implements
		AnyDescriptorType,
		Registrable,
		DuplicableType<Descriptor<TDescriptorData, TSourceData>, TDescriptorData>
{
	public readonly name: string;
	public readonly duplication: ResolvedDuplicatePolicy<
		Descriptor<TDescriptorData, TSourceData>,
		TDescriptorData
	>;
	public readonly replication?: ReplicationDefinition<TDescriptorData> | undefined;
	public readonly source: SourceType<TSourceData>;

	constructor(
		private readonly definition: DescriptorTypeDefinition<TDescriptorData, TSourceData>
	) {
		this.name = definition.name;
		this.duplication = resolveDuplicatePolicy(definition.duplication ?? { policy: "allow" });
		this.source = definition.source;
		this.replication = definition.replication;
	}

	register(registry: Registry): void {
		registerNamed(registry.descriptors, this, "descriptor");
	}

	dataEquals(a: TDescriptorData, b: TDescriptorData): boolean {
		return this.definition.dataEquals?.(a, b) ?? Object.is(a, b);
	}
}

/**
 * Defines the data structure and the SourceType this Descriptor creates.
 *
 * DescriptorTypes are immutable definitions.
 *
 * Before a Descriptor can be created, a handler must be registered first using
 * `TallyContext.registerDescriptorHandler` or `AgentState.registerDescriptorHandler`.
 */
export function defineDescriptorType<TDescriptorData, TSourceData>(
	definition: DescriptorTypeDefinition<TDescriptorData, TSourceData>
) {
	return new DescriptorType(definition);
}
