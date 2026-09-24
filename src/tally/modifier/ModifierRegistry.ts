import type { AnyProperty, Property } from "../property/Property.js";
import { SortedArray } from "../util/SortedArray.js";
import type { Modifier } from "./Modifier.js";
import type { ModifierCollection } from "./ModifierCollection.js";
import type { ModifierOrder } from "./ModifierOrder.js";

export interface ModifierHandle {
	readonly property: AnyProperty;
	readonly handle: {
		readonly modifier: unknown;
		readonly order: ModifierOrder;
	};
}

export class ModifierRegistry implements ModifierCollection {
	private readonly map = new Map<unknown, SortedArray<unknown, ModifierOrder>>();
	private allocationJournal: ModifierHandle[] | undefined;

	collectAllocations(callback: () => void): ModifierHandle[] {
		const handles: ModifierHandle[] = [];
		const previous = this.allocationJournal;
		this.allocationJournal = handles;
		try {
			callback();
			return handles;
		} catch (error) {
			this.allocationJournal = previous;
			for (let i = handles.length - 1; i >= 0; i--) this.delete(handles[i]!);
			throw error;
		} finally {
			this.allocationJournal = previous;
		}
	}

	add<T>(property: Property<T>, modifier: Modifier<T>, order: ModifierOrder): ModifierHandle {
		if (modifier.property !== property) throw new Error("Modifier does not belong to Property");
		const sarray = this.map.get(property);
		if (sarray) {
			const handle = {
				property: property,
				handle: { modifier: sarray.insert(modifier, order), order },
			};
			this.allocationJournal?.push(handle);
			return handle;
		} else {
			const newSarray = new SortedArray<unknown, ModifierOrder>((a, b) => {
				if (a.priority !== b.priority) return a.priority - b.priority;
				if (a.domain !== b.domain) return a.domain - b.domain;
				if (a.sequence !== b.sequence) return a.sequence - b.sequence;
				return a.modifierIndex - b.modifierIndex;
			});
			const handle = { modifier: newSarray.insert(modifier, order), order };
			this.map.set(property, newSarray);
			const modifierHandle = {
				property: property,
				handle,
			};
			this.allocationJournal?.push(modifierHandle);
			return modifierHandle;
		}
	}

	get<T, TModifier extends Modifier<T>>(property: Property<T, TModifier>): readonly TModifier[] {
		return (this.map.get(property)?.values() ?? []) as readonly TModifier[];
	}

	*iterator<T, TModifier extends Modifier<T>>(
		property: Property<T, TModifier>
	): Generator<TModifier> {
		const sarray = this.map.get(property);
		if (!sarray) return;
		for (const entry of sarray.iterateAscending()) yield entry as TModifier;
	}

	delete(handle: ModifierHandle): boolean {
		const property = handle.property;
		const sarray = this.map.get(property);
		if (!sarray) return false;
		const deleted = sarray.delete(handle.handle.modifier, handle.handle.order);
		if (sarray.size() === 0) this.map.delete(property);
		if (deleted && this.allocationJournal) {
			const index = this.allocationJournal.indexOf(handle);
			if (index >= 0) this.allocationJournal.splice(index, 1);
		}
		return deleted;
	}

	clear() {
		this.map.clear();
	}
}
