import type { ModifierHandle } from "../../modifier/ModifierRegistry.js";
import type { PlannedInstance } from "../PlannedInstance.js";
import type { SourceInstance } from "./SourceInstance.js";

export interface SourcePlanHost<TData> {
	createSource(): SourceInstance<TData>;
	applyModifiers(source: SourceInstance<TData>): ModifierHandle[];
	discardModifiers(handles: ModifierHandle[]): void;
	installSource(
		source: SourceInstance<TData>,
		handles: ModifierHandle[],
		cleanup: () => void
	): void;
	publish(source: SourceInstance<TData>): void;
}

export class PlannedSource<TData> implements PlannedInstance<SourceInstance<TData>> {
	private source: SourceInstance<TData> | undefined;
	private state: "pending" | "committing" | "committed" | "cancelled" = "pending";
	private cancelled = false;

	constructor(private readonly host: SourcePlanHost<TData>) {}

	get(): SourceInstance<TData> {
		if (this.state === "cancelled") throw new Error("Cannot access a cancelled planned source");
		return (this.source ??= this.host.createSource());
	}

	commit(cleanup: () => void): SourceInstance<TData> | undefined {
		if (this.state !== "pending") return;
		this.state = "committing";

		const source = this.get();
		const handles = this.host.applyModifiers(source);

		if (this.cancelled) {
			this.host.discardModifiers(handles);
			source.destroy();
			return;
		}

		this.host.installSource(source, handles, cleanup);
		this.state = "committed";
		return source;
	}

	publish(instance: SourceInstance<TData>): void {
		this.host.publish(instance);
	}

	cancel(): void {
		if (this.cancelled) return;
		const wasCommitting = this.state === "committing";
		this.state = "cancelled";
		this.cancelled = true;

		if (this.source && !wasCommitting) this.source.destroy();
	}
}
