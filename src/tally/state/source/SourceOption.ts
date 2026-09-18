import type { StateProvenance } from "../Provenance.js";

export interface SourceOption {
	readonly priority?: number | undefined;
	readonly provenance?: StateProvenance | undefined;
	readonly key?: string | undefined;
}
