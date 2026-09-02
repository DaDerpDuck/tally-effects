// Core
export { AgentState } from "./tally/core/AgentState.js";
export { TallyContext } from "./tally/core/TallyContext.js";

// Registry
export { registerProperty, type Registrable, type Registry } from "./tally/state/Registrable.js";

// Modifiers / custom Property extension
export type { AnyModifier, Modifier } from "./tally/modifier/Modifier.js";
export {
	contributeModifier,
	type ModifierContribution,
} from "./tally/modifier/ModifierContribution.js";

// Property
export {
	BooleanProperty,
	defineBooleanProperty,
	type BooleanModifier,
} from "./tally/property/BooleanProperty.js";
export {
	defineNumberProperty,
	NumberProperty,
	type NumberModifier,
} from "./tally/property/NumberProperty.js";
export type { AnyProperty, Property } from "./tally/property/Property.js";
export {
	resolvePropertyDefinition,
	type DefaultPropertyDefinition,
	type PropertyDefinition,
	type ResolvedPropertyDefinition,
} from "./tally/property/PropertyDefinition.js";

// State behavior
export type { DuplicatePolicy } from "./tally/state/duplication/DuplicatePolicy.js";
export {
	defineDuplicationGroup,
	DuplicationGroup,
	type DuplicationGroupDefinition,
} from "./tally/state/duplication/DuplicationGroup.js";
export type { ProvenanceDomain, StateProvenance } from "./tally/state/Provenance.js";

// Source
export type { Source } from "./tally/state/source/Source.js";
export type { SourceContribution } from "./tally/state/source/SourceContribution.js";
export type { SourceOption } from "./tally/state/source/SourceOption.js";
export {
	defineSourceType,
	SourceType,
	type AnySourceType,
	type SourceTypeDefinition,
} from "./tally/state/source/SourceType.js";

// Descriptor
export type { AnyDescriptor, Descriptor } from "./tally/state/descriptor/Descriptor.js";
export type { DescriptorBinding } from "./tally/state/descriptor/DescriptorBinding.js";
export type {
	DescriptorHandler,
	DescriptorHandlerContext,
} from "./tally/state/descriptor/DescriptorHandler.js";
export type { DescriptorOption } from "./tally/state/descriptor/DescriptorOption.js";
export {
	defineDescriptorType,
	DescriptorType,
	type AnyDescriptorType,
	type DescriptorTypeDefinition,
} from "./tally/state/descriptor/DescriptorType.js";

// Replication
export type { ReplicationDefinition } from "./tally/replication/ReplicationDefinition.js";
export type { ReplicationEvent } from "./tally/replication/ReplicationEvent.js";
export type { ReplicationReceiver } from "./tally/replication/ReplicationReceiver.js";
export {
	createReplicationSnapshot,
	type ReplicationSnapshot,
} from "./tally/replication/ReplicationSnapshot.js";
export type { ReplicationValue } from "./tally/replication/ReplicationValue.js";

export {
	serializeSource,
	type ReplicatedSource,
	type SourceId,
} from "./tally/replication/source/ReplicatedSource.js";
export { SourceReceiver } from "./tally/replication/source/SourceReceiver.js";
export type { SourceReplicationEvent } from "./tally/replication/source/SourceReplicationEvent.js";

export { DescriptorReceiver } from "./tally/replication/descriptor/DescriptorReceiver.js";
export type { DescriptorReplicationEvent } from "./tally/replication/descriptor/DescriptorReplicationEvent.js";
export {
	serializeDescriptor,
	type DescriptorId,
	type ReplicatedDescriptor,
} from "./tally/replication/descriptor/ReplicatedDescriptor.js";
