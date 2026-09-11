export interface PlannedInstance<TInstance> {
	get(): TInstance;
	commit(cleanup: () => void): TInstance | undefined;
	publish(instance: TInstance): void;
	cancel(): void;
}
