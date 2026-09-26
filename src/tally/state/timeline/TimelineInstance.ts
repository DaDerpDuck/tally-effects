import type { Disconnect } from "../../util/Disconnect.js";
import { registerNamed, type Registry } from "../Registrable.js";
import type { Timeline } from "./Timeline.js";
import type { TimeSource } from "./TimeSource.js";

export class TimelineInstance implements Timeline {
	private readonly tasks = new Set<readonly [time: number, callback: () => void]>();
	private anchorClock: number;
	private anchorTimeline = 0;
	private rate = 1;

	constructor(
		public readonly name: string,
		private readonly clock: TimeSource,
		pumps: Array<() => void>
	) {
		this.anchorClock = clock.now();
		pumps.push(() => this.tick());
	}

	scheduleAt(time: number, callback: () => void): Disconnect {
		const entry = [time, callback] as const;
		this.tasks.add(entry);
		return () => this.tasks.delete(entry);
	}

	now(): number {
		return this.anchorTimeline + (this.clock.now() - this.anchorClock) * this.rate;
	}

	setRate(rate: number) {
		if (!Number.isFinite(rate) || rate < 0)
			throw new RangeError("Timeline rate must be finite and nonnegative");

		const clockNow = this.clock.now();
		this.anchorTimeline += (clockNow - this.anchorClock) * this.rate;
		this.anchorClock = clockNow;
		this.rate = rate;
	}

	private tick() {
		const now = this.now();
		let errors: unknown[] | undefined = undefined;
		for (const task of this.tasks) {
			if (task[0] <= now) {
				try {
					task[1]();
				} catch (e) {
					if (errors === undefined) errors = [];
					errors.push(e);
				} finally {
					this.tasks.delete(task);
				}
			}
		}
		if (errors !== undefined)
			throw new AggregateError(errors, `${errors.length} error(s) occurred during tick`);
	}

	register(registry: Registry): void {
		registerNamed(registry.timelines, this, "timeline");
	}
}
