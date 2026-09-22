import type { AgentState } from "../../core/AgentState.js";
import type { Source } from "../source/Source.js";
import type { SourceOption } from "../source/SourceOption.js";
import type { AnyDescriptorBinding, DescriptorBinding } from "./DescriptorBinding.js";

export interface DescriptorHandlerContext<TEntity, TSourceData> {
	readonly agent: AgentState<TEntity>;
	addSource(data: TSourceData, options?: SourceOption): Source<TSourceData> | undefined;
}

export type AnyDescriptorHandler = (
	ctx: DescriptorHandlerContext<unknown, unknown>,
	data: unknown
) => AnyDescriptorBinding | undefined;

/**
 * The handler that is invoked when the associated Descriptor is added. Register a
 * handler using `TallyContext.registerDescriptorHandler` or
 * `AgentState.registerDescriptorHandler`.
 *
 * Prefer adding sources using the passed context rather than the agent. Provenance
 * is set using the context's addSource method so that the added Source does not
 * erroneously replicate.
 *
 * Descriptor handlers and their bindings may synchronously mutate the AgentState
 * through this context. That mutation reentrancy is supported.
 *
 * @see {@link DescriptorHandlerContext}
 */
export type DescriptorHandler<TEntity, TDescriptorData, TSourceData> = (
	ctx: DescriptorHandlerContext<TEntity, TSourceData>,
	data: TDescriptorData
) => DescriptorBinding<TDescriptorData, TSourceData> | undefined;
