import assert from "node:assert/strict";
import { AgentState, defineNumberProperty, defineSourceType } from "../../src/index.js";
import type { Scenario } from "../shared/scenario.js";

export function createFrameScenario(agentCount: number, batched: boolean): Scenario {
	const attack = defineNumberProperty({ name: "Attack", defaultValue: 100 });
	const armor = defineNumberProperty({ name: "Armor", defaultValue: 0 });
	const speed = defineNumberProperty({ name: "Speed", defaultValue: 16 });
	const equipment = defineSourceType<number>({
		name: "Equipment",
		priority: 0,
		contribute: (value) => [attack.add(value), armor.add(value)],
	});
	const stanceType = defineSourceType<number>({
		name: "Stance",
		priority: 100,
		contribute: (value) => [attack.add(value), armor.add(value), speed.add(value)],
	});
	const fatigueType = defineSourceType<number>({
		name: "Fatigue",
		priority: 200,
		contribute: (value) => [speed.multiply(value)],
	});
	const actors = Array.from({ length: agentCount }, () => {
		const agent = new AgentState(undefined);
		agent.batch(() => {
			for (let i = 0; i < 8; i++) agent.addSource(equipment, 1);
		});
		const stance = agent.addSource(stanceType, 1)!;
		const fatigue = agent.addSource(fatigueType, 0.5)!;
		const observed = { speed: agent.get(speed), notifications: 0 };
		agent.onPropertyChanged(speed, (value) => {
			observed.speed = value;
			observed.notifications++;
		});
		return { agent, stance, fatigue, observed };
	});
	let high = false;
	let checksum = 0;

	return {
		run() {
			high = !high;
			checksum = 0;
			for (const { agent, stance, fatigue } of actors) {
				const update = () => {
					stance.set(high ? 2 : 1);
					fatigue.set(high ? 1 : 0.5);
				};
				if (batched) agent.batch(update);
				else update();
				// Gameplay consumes the cached results after the frame's mutations.
				checksum += agent.get(attack) + agent.get(armor) + agent.get(speed);
			}
		},
		verify() {
			assert.equal(checksum, agentCount * (high ? 138 : 126.5));
			for (const { agent, observed } of actors) {
				assert.equal(agent.getSources().size, 10);
				assert.equal(agent.getDescriptors().size, 0);
				assert.equal(agent.get(attack), high ? 110 : 109);
				assert.equal(agent.get(armor), high ? 10 : 9);
				assert.equal(observed.speed, high ? 18 : 8.5);
				assert.ok(observed.notifications > 0);
			}
		},
		destroy() {
			for (const { agent } of actors) agent.destroy();
		},
	};
}
