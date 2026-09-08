# Benchmarks

Run all microbenchmarks and scenarios:

```sh
npm run bench
```

Use the quick profile while changing workloads, and the comparison profile when
recording results. `default` is an alias for `comparison`.

```sh
npm run bench -- --profile quick --log-level warn
npm run bench:repeat -- --profile comparison --runs 5
```

| Profile      | Measurement minimum | Warmup minimum | Samples / warmup samples |
| ------------ | ------------------: | -------------: | -----------------------: |
| `quick`      |               50 ms |          50 ms |                 500 / 50 |
| `comparison` |              250 ms |         250 ms |              1,000 / 100 |

Heavy suites lower their minimum sample counts (normally 20 / 5) while retaining
the profile's time windows. Resolution uses at least 128 samples and source
snapshot updates use 64. Time and iteration limits are both minimums; total runtime
also includes setup, cleanup, and statistics. Execution is synchronous and sequential.

## Selecting workloads

Pass one or more suites to either runner. Repeated runs use separate Node processes
and aggregate each task independently; they do not select one entire "median run."

```sh
npm run bench -- duplication resolution --profile quick
npm run bench:scenarios -- --profile quick
npm run bench:repeat -- combat sync --profile comparison --runs 5
```

Available selectors: `duplication`, `lifecycle`, `resolution`, `replication`,
`combat`, `frames`, and `sync`. `scenarios` expands to `combat frames sync`.
Duplicate selectors run only once. Invalid selectors fail before any work runs.
The existing `bench:duplication`, `bench:lifecycle`, `bench:resolution`, and
`bench:replication` scripts still work.

| Scenario | Sizes                                                      | One measured operation                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `combat` | 1, 10, 100 agents                                          | An encounter across all agents: apply buffs, reconcile slows, replace shield descriptors, reject duplicate stuns, update effects, then remove them. Includes property notifications and reads after each phase. |
| `frames` | 10, 100, 1,000 agents                                      | One frame updating stance and fatigue on every agent, with 8 permanent equipment sources per agent. Includes speed notifications and reads of attack, armor, and speed.                                         |
| `sync`   | 10, 100, 1,000 sources plus the same number of descriptors | One mixed snapshot or event batch. Half the remote IDs are updated, half are removed/replaced. Both receivers run in an outer agent batch; a local prediction survives reconciliation.                          |

Combat and frame cases each have batched and unbatched variants. They reach the
same final values; batching intentionally reduces intermediate resolutions and
notifications. Combat expiry is explicit destruction performed by the workload,
without timers or a Timeline implementation. Sync measures receiver application;
payload creation, transport, and JSON encoding are outside its scope.

Scenario types, agents, handlers, observers, permanent effects, and replication
payloads are prepared outside timing. Fixtures are recreated for warmup and
measurement. Combat includes transient effect creation/destruction in timing;
frame and sync fixtures maintain bounded active populations between samples.
Each fixture validates its values and live object counts in an untimed preflight
and after each phase. Replication also validates remote IDs and echo suppression.
Small deterministic correctness tests run in `npm test`, without running Tinybench.

One scenario operation means **the entire encounter, frame, or replication batch**,
not one agent or one effect. Use its total latency to estimate that workload's cost.

Microbenchmarks isolate smaller paths. The original resolution suite updates the
last modifier; a separate suite updates the middle to include ordered-array shifts.
Duplication separates an empty reconcile callback from reconciliation that updates
a real modifier. Replication covers both source and descriptor snapshot updates.

## Output and comparison

Use `info` for tables and warnings, `warn` for warnings only, or `silent` for no
benchmark output. Failures still exit unsuccessfully at every log level.

```sh
npm run bench -- scenarios --profile quick --log-level silent --output benchmarks/results/single.json
npm run bench:repeat -- scenarios --runs 5 --log-level warn --output benchmarks/results/scenarios.json
npm run bench:compare -- baseline.json candidate.json
```

Without `--output`, repeated reports go to
`benchmarks/results/benchmark-<commit>.json`. Single runs write JSON only when an
output path is provided. Comparisons default to
`benchmarks/results/comparison-<baseline>-vs-<candidate>.md`; an optional third
positional path overrides that location. Parent directories are created automatically.
The results directory is ignored by Git. Reusing a default filename overwrites it,
including when running a different suite or profile on the same commit. Use explicit
paths to retain multiple measurements.

Schema-2 JSON records the runtime/machine, normalized profile, effective suite timing
settings, timer provider, batch sizes, warnings, and whether the checkout was dirty.
Avoid editing code during runs. Aggregation rejects mismatched revisions, settings,
environments, or task lists. Comparisons accept single runs and legacy schema-1 reports,
show added/removed tasks, and include diagnostics from **both** baseline and candidate.
Known profile, environment, timing, or batch-size mismatches suppress percentage changes.
Legacy files may lack the metadata needed to detect those mismatches.

Repeated reports include these distinct measures, computed across the per-run medians:

| Field                | Meaning                                                |
| -------------------- | ------------------------------------------------------ |
| `medianOfMedianNs`   | Median latency across processes, in ns/op              |
| `madNs`              | Median absolute distance from that median, in ns/op    |
| `relativeMadPercent` | `madNs / medianOfMedianNs * 100`                       |
| `rangeSpreadPercent` | `(maxMedianNs - minMedianNs) / medianOfMedianNs * 100` |
| `runMedianNs`        | Every process's median, retained for inspection        |

Relative MAD above 1% is displayed as a diagnostic, preserving the branch's reporting
preference. It is not a statistical significance test or a universal instability
threshold. Range spread shows extreme observations that MAD can hide. Fewer than
three runs are flagged; even five runs can understate variability. Zero medians make
relative measures unavailable and percentage comparisons inconclusive.

## Interpreting timing

Very fast operations are batched to reduce timer quantization. JSON and tables
normalize batch durations to ns/op. Hooks on batched tasks run per **sample**, not
per inner operation, so only workloads that remain bounded across all inner calls
are batched this way. `operationsPerSample` records the divisor. The normalized p99
is the p99 of sample averages, **not** the p99 of individual operations in a batch.

Tinybench saturation warnings need investigation before interpreting small changes:

- `zero-mad`: median absolute deviation is zero, often due to timer quantization.
- `zero-dominated`: most measurements are zero.
- `low-distinct`: too few distinct timings were observed.

Increasing work per sample helps the timer distinguish durations. Longer time windows
and repeated processes help sampling, but cannot eliminate JIT, GC, thermal, or system
load differences. Keep runtime, hardware, power mode, and background load comparable.
Run baseline and candidate sequentially; alternate their order for serious comparisons.

Results are informational, with no CI performance gate. The manual benchmark workflow
requires a baseline revision that already contains the harness; merge the infrastructure
before using `main` as that baseline. Workload changes can also require a new baseline,
even when a task's label remains the same.
