export class SortedArray<T, O> {
	private readonly array = new Array<[T, O]>();

	constructor(private readonly comparator: (a: O, b: O) => number) {}

	insert(value: T, order: O): T {
		let i = 0;
		let j = this.array.length - 1;
		while (i <= j) {
			const mid = i + (((j - i) * 0.5) | 0);
			if (this.comparator(order, this.array[mid]![1]) >= 0) {
				i = mid + 1;
			} else {
				j = mid - 1;
			}
		}
		this.array.splice(i, 0, [value, order]);
		return value;
	}

	delete(value: T, order: O): boolean {
		let i = 0;
		let j = this.array.length - 1;
		while (i <= j) {
			const mid = i + (((j - i) * 0.5) | 0);
			if (this.comparator(order, this.array[mid]![1]) > 0) {
				i = mid + 1;
			} else {
				j = mid - 1;
			}
		}
		for (let k = i; k < this.array.length; k++) {
			if (this.array[k]![0] === value) {
				this.array.splice(k, 1);
				return true;
			}
		}
		return false;
	}

	values(): T[] {
		const array = new Array<T>(this.array.length);
		for (let i = 0; i < this.array.length; i++) {
			array[i] = this.array[i]![0];
		}
		return array;
	}

	*iterateAscending(): Generator<T> {
		for (let i = 0; i < this.array.length; i++) {
			yield this.array[i]![0];
		}
	}

	*iterateDescending(): Generator<T> {
		for (let i = this.array.length - 1; i >= 0; i--) {
			yield this.array[i]![0];
		}
	}

	size(): number {
		return this.array.length;
	}

	clear() {
		this.array.length = 0;
	}
}
