import {
	AgentState,
	defineDescriptorType,
	defineSourceType,
	testReporter,
	type Descriptor,
	type Source,
} from "../src/index.js";

const undefinedSourceType = defineSourceType<undefined>({
	name: "BuilderOptionalSourceData",
	priority: 100,
	contribute: () => [],
});

const undefinedDescriptorType = defineDescriptorType<undefined, undefined>({
	name: "BuilderOptionalDescriptorData",
	source: undefinedSourceType,
});

const agent = new AgentState(undefined, { reporter: testReporter });

// Direct creation accepts omitted data when the type's data is undefined.
const directSource: Source<undefined> | undefined = agent.addSource(undefinedSourceType);
const directDescriptor: Descriptor<undefined, undefined> | undefined =
	agent.addDescriptor(undefinedDescriptorType);

// Builders preserve the same optional-data call shape.
const builtSource: Source<undefined> | undefined = agent.makeSource(undefinedSourceType).add();
const builtDescriptor: Descriptor<undefined, undefined> | undefined = agent
	.makeDescriptor(undefinedDescriptorType)
	.add();

void directSource;
void directDescriptor;
void builtSource;
void builtDescriptor;
