export interface PlannedInstance<TInstance> {
	get(): TInstance;
	publish(): TInstance | undefined;
	cancel(): void;
}
