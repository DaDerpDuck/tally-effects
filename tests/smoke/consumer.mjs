import { AgentState, defineNumberProperty, defineSourceType } from "tally-effects";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
	if (!Object.is(actual, expected))
		throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const health = defineNumberProperty({
	name: "health",
	defaultValue: 100,
});

const damage = defineSourceType({
	name: "damage",
	priority: 0,

	contribute(amount) {
		return [health.add(-amount)];
	},
});

const reporter = { report() {} };
const agent = new AgentState({ id: "smoke-test" }, { reporter });

assertEqual(agent.get(health), 100, "default property value");

const source = agent.addSource(damage, 25);

assert(source !== undefined, "source should be created");
assertEqual(agent.get(health), 75, "source should modify property");

source.set(40);

assertEqual(agent.get(health), 60, "source update should modify property");

source.destroy();

assertEqual(agent.get(health), 100, "destroying source should restore property");

agent.destroy();

console.log("Tally smoke test passed");
