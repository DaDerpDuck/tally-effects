import type { Timeline } from "./Timeline.js";
import { TimelineInstance } from "./TimelineInstance.js";
import type { TimeSource } from "./TimeSource.js";

export interface VirtualClockOptions {
	now(): number;
}

export class VirtualClock implements TimeSource {
	private readonly pumps = new Array<() => void>();

	constructor(private readonly definition: VirtualClockOptions) {}

	now(): number {
		return this.definition.now();
	}

	tick() {
		let errors: unknown[] | undefined = undefined;
		for (let i = 0; i < this.pumps.length; i++) {
			try {
				this.pumps[i]!();
			} catch (e) {
				if (errors === undefined) errors = [];
				errors.push(e);
			}
		}
		if (errors !== undefined)
			throw new AggregateError(errors, `${errors.length} error(s) occurred during tick`);
	}

	createTimeline(name: string, parent?: Timeline): Timeline {
		return new TimelineInstance(name, parent ?? this, this.pumps);
	}
}
