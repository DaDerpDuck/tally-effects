import type { ReplicatedDescriptor, ReplicatedSource } from "../src/index.js";

// Replication payloads emitted before duplication keys were introduced remain
// valid unkeyed payloads at the serialization boundary.
const legacySource: ReplicatedSource = {
	id: 1,
	type: "LegacySource",
	priority: 100,
	data: null,
};

const legacyDescriptor: ReplicatedDescriptor = {
	id: 2,
	type: "LegacyDescriptor",
	data: null,
};

void legacySource;
void legacyDescriptor;
