export class AgentMutationGate {
	private activeHook: string | undefined;

	evaluate<T>(hook: string, callback: () => T): T {
		const previousHook = this.activeHook;
		this.activeHook = hook;
		try {
			return callback();
		} finally {
			this.activeHook = previousHook;
		}
	}

	assertMutationAllowed() {
		const hook = this.activeHook;
		if (hook) throw new Error(`Cannot mutate AgentState while evaluating ${hook}`);
	}
}
