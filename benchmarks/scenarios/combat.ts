import assert from "node:assert/strict";
import {
	AgentState,
	defineBooleanProperty,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	type Descriptor,
	type Source,
} from "../../src/index.js";
import type { Scenario } from "../shared/scenario.js";

export function createCombatScenario(agentCount: number, batched: boolean): Scenario {
	const attack = defineNumberProperty({ name: "Attack", defaultValue: 100 });
	const armor = defineNumberProperty({ name: "Armor", defaultValue: 0 });
	const speed = defineNumberProperty({ name: "Speed", defaultValue: 16 });
	const stunned = defineBooleanProperty({ name: "Stunned", defaultValue: false });
	const equipment = defineSourceType<number>({
		name: "Equipment",
		priority: 0,
		contribute: (value) => [attack.add(value), armor.add(value)],
	});
	const buffType = defineSourceType<number>({
		name: "Buff",
		priority: 100,
		contribute: (value) => [attack.multiply(value), speed.multiply(value)],
	});
	const slowType = defineSourceType<number>({
		name: "Slow",
		priority: 200,
		contribute: (value) => [speed.multiply(value)],
		duplication: { policy: "reconcile", reconcile: (existing, value) => existing.set(value) },
	});
	const stunType = defineSourceType<undefined>({
		name: "Stun",
		priority: 1000,
		contribute: () => [stunned.enable(), speed.override(0)],
		duplication: { policy: "ignore" },
	});
	const shieldSource = defineSourceType<number>({
		name: "ShieldSource",
		priority: 100,
		contribute: (value) => [armor.add(value)],
	});
	const shieldType = defineDescriptorType<number, number>({
		name: "Shield",
		source: shieldSource,
		duplication: { policy: "replace" },
	});
	let notifications = 0;
	let checksum = 0;
	const agents = Array.from({ length: agentCount }, () => {
		const agent = new AgentState(undefined);
		agent.registerDescriptorHandler(shieldType, (context, value) => {
			const source = context.addSource(value)!;
			return { source, update: (next) => source.set(next), destroy: () => source.destroy() };
		});
		agent.batch(() => {
			for (let value = 1; value <= 4; value++) agent.addSource(equipment, value);
		});
		for (const property of [attack, armor, speed]) {
			agent.onPropertyChanged(property, () => notifications++);
		}
		agent.onPropertyChanged(stunned, () => notifications++);
		return agent;
	});
	const mutate = (agent: AgentState<undefined>, callback: () => void) => {
		if (batched) agent.batch(callback);
		else callback();
	};
	const read = (agent: AgentState<undefined>) =>
		agent.get(attack) + agent.get(armor) + agent.get(speed) + Number(agent.get(stunned));

	return {
		run() {
			checksum = 0;
			notifications = 0;
			for (const agent of agents) {
				let buff: Source<number>;
				let slow: Source<number>;
				let stun: Source<undefined>;
				let shield: Descriptor<number, number>;
				// Apply overlapping effects; exercise reconcile, replace, and ignore.
				mutate(agent, () => {
					buff = agent.addSource(buffType, 2)!;
					slow = agent.addSource(slowType, 0.5)!;
					agent.addSource(slowType, 0.25);
					agent.addDescriptor(shieldType, 10);
					shield = agent.addDescriptor(shieldType, 20)!;
					stun = agent.addSource(stunType)!;
					agent.addSource(stunType);
				});
				checksum += read(agent);
				mutate(agent, () => {
					buff.set(1.5);
					shield.set(30);
					stun.destroy();
					agent.addSource(slowType, 0.5);
				});
				checksum += read(agent);
				// Expiry is explicit host work. Tally does not yet provide a timeline.
				mutate(agent, () => {
					buff.destroy();
					slow.destroy();
					shield.destroy();
				});
				checksum += read(agent);
			}
		},
		verify() {
			assert.equal(checksum, agentCount * (251 + 217 + 136));
			assert.ok(notifications > 0);
			for (const agent of agents) {
				assert.equal(agent.getSources().size, 4);
				assert.equal(agent.getDescriptors().size, 0);
				assert.equal(agent.get(attack), 110);
				assert.equal(agent.get(armor), 10);
				assert.equal(agent.get(speed), 16);
				assert.equal(agent.get(stunned), false);
			}
		},
		destroy() {
			for (const agent of agents) agent.destroy();
		},
	};
}
