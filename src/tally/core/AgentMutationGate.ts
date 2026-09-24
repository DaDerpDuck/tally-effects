export class AgentMutationGate {
	private static readonly agentGates = new WeakMap<object, AgentMutationGate>();
	private activeHook: string | undefined;

	constructor(agent?: object) {
		if (agent) AgentMutationGate.agentGates.set(agent, this);
	}

	static forAgent(agent: object): AgentMutationGate {
		const gate = AgentMutationGate.agentGates.get(agent);
		if (!gate) throw new Error("AgentState mutation gate is unavailable");
		return gate;
	}

	/** Restricts same-agent mutations while the callback runs, restoring any outer gate afterward. */
	evaluate<T>(hook: string, callback: () => T): T {
		const previousHook = this.activeHook;
		this.activeHook = hook;
		try {
			return callback();
		} finally {
			this.activeHook = previousHook;
		}
	}

	/** Rejects a mutation attempted while a restricted hook is being evaluated. */
	assertMutationAllowed() {
		const hook = this.activeHook;
		if (hook) throw new Error(`Cannot mutate AgentState while evaluating ${hook}`);
	}
}
