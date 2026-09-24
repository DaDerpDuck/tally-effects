# Reentrancy glossary

Tally calls application code synchronously. That code can call back into Tally before the
original operation returns. This document names the boundaries that matter when reviewing
Source, Descriptor, Property, admission, and replication changes.

## Terms

- **Mutation reentrancy** means adding, updating, or destroying Source or Descriptor state on
  the same `AgentState` while Tally is invoking application code. It does not mean ordinary
  recursion. A mutation gate is scoped to one agent; mutating another agent is permitted.
- **Restricted hook** is application code that must run with a stable view of that agent's
  state. Examples include data equality, contribution, Modifier allocation, Property
  resolution and equality, duplication rank and replacement, replication serialization,
  receiver type lookup, and deserialization. Same-agent mutations attempted from these
  hooks throw. Reads remain possible; a batched read can still see the previous cached
  Property value.
- **Reentrant callback** is application code that Tally invokes without opening a new
  mutation gate. Observation callbacks, duplication reconciliation, Descriptor handlers,
  and Descriptor bindings can synchronously mutate agent state. An _already active_ gate
  still applies if a callback is reached from within a restricted hook.
- **Mutation entry check** is `AgentMutationGate.assertMutationAllowed()`. It rejects a
  mutation while a restricted hook is active. `AgentMutationGate.evaluate()` opens a
  restricted span and restores the previous span on return or throw. The gate does not
  serialize work or prevent callbacks from running.
- **Pending admission** is a reserved Source or Descriptor candidate that nested
  admission can see before it becomes live. A candidate may be reconciled, replaced, or
  cancelled at this point. **Commit** makes a completed candidate live; **publication**
  fires its public added notification afterward. A cancelled candidate is rolled back
  without its own added or removed notification.
- **Required pre-commit work** (such as contribution, allocation, binding, and admission
  decisions) can throw and cancel admission. **Best-effort observation and teardown**
  report callback or cleanup failures after state commits and continue independent work.

## JSDoc tags

| Tag                              | Meaning                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@mutationReentrancy restricted` | The callback contract forbids same-agent state mutation while invoked.                                                       |
| `@mutationReentrancy supported`  | This callback boundary does not itself restrict same-agent mutation. An ambient gate still applies.                          |
| `@requiresMutationGate`          | This callback or helper must be invoked under a gate established by its caller; it does not open one locally.                |
| `@providesMutationGate`          | This method directly calls `evaluate()` around restricted application code. Only the evaluated callback runs under the gate. |
| `@checksMutationGate`            | This mutation entry point directly calls `assertMutationAllowed()`.                                                          |

For example, `serializeSource()` requires a gate from its caller. The replication emitter
and snapshot creator provide one around that call. Adding another `evaluate()` inside
`serializeSource()` would nest gates without strengthening the boundary. Conversely,
`SourceRuntime.set()` checks the gate before mutation and provides a gate around its data
equality hook; it can correctly carry both tags.

When a new user callback is introduced, first decide whether its mutation reentrancy is
restricted or supported. If restricted, put `evaluate()` at the closest call site and
mark any ungated helper on that path with `@requiresMutationGate`. If supported, preserve
the admission, update, or teardown invariants when it calls back into Tally.
