import type { PlannedInstance } from "../PlannedInstance.js";
import type { DescriptorInstance } from "./DescriptorInstance.js";

export interface DescriptorPlanHost<TDescriptorData, TSourceData> {
	createDescriptor(): DescriptorInstance<TDescriptorData, TSourceData>;
	installDescriptor(descriptor: DescriptorInstance<TDescriptorData, TSourceData>, cleanup: () => void): void;
	publish(descriptor: DescriptorInstance<TDescriptorData, TSourceData>): void;
}

export class PlannedDescriptor<TDescriptorData, TSourceData> implements PlannedInstance<
	DescriptorInstance<TDescriptorData, TSourceData>
> {
	private descriptor: DescriptorInstance<TDescriptorData, TSourceData> | undefined;
	private state: "pending" | "committing" | "committed" | "cancelled" = "pending";
	private cancelled = false;

	constructor(private readonly host: DescriptorPlanHost<TDescriptorData, TSourceData>) {}

	get(): DescriptorInstance<TDescriptorData, TSourceData> {
		if (this.state === "cancelled") throw new Error("Cannot access a cancelled planned source");
		return (this.descriptor ??= this.host.createDescriptor());
	}

	commit(cleanup: () => void): DescriptorInstance<TDescriptorData, TSourceData> | undefined {
		if (this.state !== "pending") return;
		this.state = "committing";

		const descriptor = this.get();

		try {
			if (!descriptor.tryBind() || this.cancelled) {
				descriptor.destroy();
				return;
			}

			this.host.installDescriptor(descriptor, cleanup);
			this.state = "committed";
			return descriptor;
		} catch (e) {
			descriptor.destroy();
			throw e;
		}
	}

	publish(instance: DescriptorInstance<TDescriptorData, TSourceData>): void {
		this.host.publish(instance);
	}

	cancel(): void {
		if (this.cancelled) return;
		const wasCommitting = this.state === "committing";
		this.state = "cancelled";
		this.cancelled = true;

		if (this.descriptor && !wasCommitting) this.descriptor.destroy();
	}
}
