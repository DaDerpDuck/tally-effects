import {
	defineDescriptorType,
	defineSourceType,
	type Descriptor,
	type DuplicatePolicy,
	type Source,
} from "../src/index.js";

const SourceType = defineSourceType<number>({
	name: "PublicSourceDuplicationPolicy",
	priority: 100,
	duplication: { policy: "ignore" },
	contribute: () => [],
});

const DescriptorType = defineDescriptorType<number, number>({
	name: "PublicDescriptorDuplicationPolicy",
	source: SourceType,
	duplication: { policy: "replace" },
});

// Definitions have always exposed their declared policy. Internal normalization
// must not make consumers depend on the resolver's `kind` representation.
const sourceDuplication: DuplicatePolicy<Source<number>, number> = SourceType.duplication;
const descriptorDuplication: DuplicatePolicy<
	Descriptor<number, number>,
	number
> = DescriptorType.duplication;

void sourceDuplication;
void descriptorDuplication;
