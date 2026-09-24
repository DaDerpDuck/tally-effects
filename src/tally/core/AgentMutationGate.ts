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
