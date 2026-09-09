export type BenchmarkSide = "baseline" | "candidate";

/** Each round contains one fresh run of each revision; never overlap the runs. */
export async function interleave<T>(
	rounds: number,
	run: (side: BenchmarkSide, round: number) => Promise<T>
): Promise<Record<BenchmarkSide, T[]>> {
	if (!Number.isSafeInteger(rounds) || rounds < 1) {
		throw new Error("--runs must be a positive safe integer (runs per revision)");
	}
	const results: Record<BenchmarkSide, T[]> = { baseline: [], candidate: [] };
	for (let round = 1; round <= rounds; round++) {
		const order: BenchmarkSide[] =
			round % 2 === 1 ? ["baseline", "candidate"] : ["candidate", "baseline"];
		for (const side of order) results[side].push(await run(side, round));
	}
	return results;
}
