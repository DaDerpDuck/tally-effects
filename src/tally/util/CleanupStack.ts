export class CleanupStack {
	private readonly stack = new Array<() => void>();

	defer(action: () => void) {
		this.stack.push(action);
	}

	cleanup() {
		const errors = new Array<unknown>();
		for (let i = this.stack.length - 1; i >= 0; i--) {
			try {
				this.stack[i]!();
			} catch (e) {
				errors.push(e);
			}
		}
		this.stack.length = 0;
		return errors;
	}
}
