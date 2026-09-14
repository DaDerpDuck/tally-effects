import { defineDuplicationGroup, defineSourceType } from "../src/index.js";

interface FireData {
	readonly heat: number;
}

interface PoisonData {
	readonly toxicity: number;
}

const group = defineDuplicationGroup({
	policy: "replace",
	maxStack: 2,
	selector: "lowest",
});

defineSourceType<FireData>({
	name: "TypedFireGroupMember",
	priority: 100,
	duplication: group.member<FireData>({
		rank: (data) => data.heat,
	}),
	contribute: () => [],
});

defineSourceType<PoisonData>({
	name: "TypedPoisonGroupMember",
	priority: 100,
	duplication: group.member<PoisonData>({
		rank: (data) => data.toxicity,
	}),
	contribute: () => [],
});
