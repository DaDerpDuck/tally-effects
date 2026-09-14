import type { Disconnect } from "./Disconnect.js";

export class CallbackSet<TArgs extends readonly unknown[]> {
	private readonly callbacks = new Set<(...args: TArgs) => void>();

	add(callback: (...args: TArgs) => void): Disconnect {
		this.callbacks.add(callback);
		return () => this.callbacks.delete(callback);
	}

	emit(...args: TArgs): unknown[] {
		const errors = new Array<unknown>();

		for (const callback of this.callbacks) {
			try {
				callback(...args);
			} catch (e) {
				errors.push(e);
			}
		}

		return errors;
	}

	clear() {
		this.callbacks.clear();
	}
}

export function throwCallbackErrors(errors: readonly unknown[], message: string) {
	if (errors.length === 0) return;
	const details = errors
		.map((error) => (error instanceof Error ? error.message : String(error)))
		.join("; ");
	throw new AggregateError(errors, `${message}: ${details}`);
}
