export interface PlannedInstance<TInstance> {
	get(): TInstance;
	commit(): TInstance | undefined;
	publish(instance: TInstance): void;
	cancel(): void;
}
