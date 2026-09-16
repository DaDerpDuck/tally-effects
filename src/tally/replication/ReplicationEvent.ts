import type { DescriptorReplicationEvent } from "./descriptor/DescriptorReplicationEvent.js";
import type { SourceReplicationEvent } from "./source/SourceReplicationEvent.js";

/**
 * A state change emitted by an AgentState.
 *
 * Tally does not send this event over a network. Applications are
 * responsible for transporting events to the corresponding receiver.
 */
export type ReplicationEvent =
	| { target: "source"; event: SourceReplicationEvent }
	| { target: "descriptor"; event: DescriptorReplicationEvent };
