import type { AnyProperty } from "../property/Property.js";
import type { AnyDescriptorType } from "../state/descriptor/DescriptorType.js";
import type { AnySourceType } from "../state/source/SourceType.js";
import type { Timeline } from "./timeline/Timeline.js";

export interface Registry {
	readonly sources: Map<string, AnySourceType>;
	readonly properties: Map<string, AnyProperty>;
	readonly descriptors: Map<string, AnyDescriptorType>;
	readonly timelines: Map<string, Timeline>;
}

export interface Registrable {
	register(registry: Registry): void;
}

export function registerNamed<T extends { readonly name: string }>(
	registry: Map<string, T>,
	value: T,
	kind: string
) {
	const existing = registry.get(value.name);

	if (existing !== undefined && existing !== value)
		throw new Error(`Duplicate ${kind} name: ${value.name}`);

	registry.set(value.name, value);
}

export function registerProperty(registry: Registry, property: AnyProperty) {
	return registerNamed(registry.properties, property, "property");
}
