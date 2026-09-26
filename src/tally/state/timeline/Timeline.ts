import type { Disconnect } from "../../util/Disconnect.js";
import type { Registrable } from "../Registrable.js";
import type { TimeSource } from "./TimeSource.js";

export interface Timeline extends TimeSource, Registrable {
	readonly name: string;

	scheduleAt(time: number, callback: () => void): Disconnect;
	setRate(rate: number): void;
}
