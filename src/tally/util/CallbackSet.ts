import { tallyReport, type TallyReport, type TallyReporter } from "../core/TallyReporter.js";
import type { Disconnect } from "./Disconnect.js";

interface Subscription<TArgs extends readonly unknown[]> {
	callback: (...args: TArgs) => void;
	connected: boolean;
}

type CallbackErrorContext = Omit<TallyReport, "error" | "code"> & {
	readonly code?: "callback-failed";
};

export class CallbackSet<TArgs extends readonly unknown[]> {
	private readonly subscriptions = new Set<Subscription<TArgs>>();

	constructor(
		private readonly reporter: TallyReporter,
		private readonly contextProvider: (...args: TArgs) => CallbackErrorContext
	) {}

	isEmpty(): boolean {
		return this.subscriptions.size === 0;
	}

	add(callback: (...args: TArgs) => void): Disconnect {
		const subscription: Subscription<TArgs> = { callback, connected: true };
		this.subscriptions.add(subscription);
		return () => {
			if (!subscription.connected) return;
			subscription.connected = false;
			this.subscriptions.delete(subscription);
		};
	}

	emit(...args: TArgs): void {
		const subscriptions = [...this.subscriptions];
		for (const subscription of subscriptions) {
			if (!subscription.connected) continue;
			try {
				subscription.callback(...args);
			} catch (callbackError) {
				tallyReport(this.reporter, {
					...this.contextProvider(...args),
					code: "callback-failed",
					error: callbackError,
				});
			}
		}
	}

	clear() {
		for (const subscription of this.subscriptions) subscription.connected = false;
		this.subscriptions.clear();
	}
}
