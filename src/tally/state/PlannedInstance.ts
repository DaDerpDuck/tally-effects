export interface PlannedInstance<TInstance> {
	get(): TInstance;
	publish(): TInstance;
	cancel(): void;
}
