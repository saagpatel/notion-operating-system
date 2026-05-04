export async function mapWithConcurrency<T, TResult>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
	const workerCount = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array<TResult>(items.length);
	let nextIndex = 0;

	async function runWorker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await worker(items[index]!, index);
		}
	}

	await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
	return results;
}
