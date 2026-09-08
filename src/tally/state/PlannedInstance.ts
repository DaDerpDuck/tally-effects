export interface PlannedInstance<TInstance> {
	readonly instance: TInstance;
	publish(this: void): TInstance;
	cancel(this: void): void;
}
