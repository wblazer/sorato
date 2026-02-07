/**
 * A Dataset is a collection of Scenarios — the inputs to a benchmark run.
 *
 * Each Scenario carries:
 *   - `id`: a stable identifier for diffing results across runs, caching, etc.
 *   - `input`: the prompt/task description handed to the harness
 *   - `expected`: whatever the rubric needs to judge the output against
 *   - `metadata`: a generic bag for user-defined context (tags, difficulty, etc.)
 *
 * The library is deliberately agnostic about what `input`, `expected`, and
 * `metadata` contain. You bring your own schemas; the Dataset just holds them.
 */
import type { Effect } from 'effect'

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

/**
 * A single benchmark scenario. Generic over:
 *   - `Input`    – what gets fed to the harness (usually a string prompt)
 *   - `Expected` – what the rubric compares against
 *   - `Meta`     – arbitrary user metadata (default: empty record)
 */
export interface Scenario<
  Input = string,
  Expected = string,
  Meta = Record<string, never>,
> {
  readonly id: string
  readonly input: Input
  readonly expected: Expected
  readonly metadata: Meta
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

/**
 * A dataset is fundamentally just an effectful way to obtain scenarios.
 *
 * Why effectful? Because datasets can be loaded from files, APIs, databases —
 * any source that might fail or require context. The `R` parameter lets you
 * declare those requirements (e.g. `FileSystem`, `HttpClient`).
 *
 * Generic parameters mirror `Scenario<Input, Expected, Meta>` plus:
 *   - `E` – errors that can occur when loading
 *   - `R` – Effect requirements for loading
 */
export interface Dataset<
  Input = string,
  Expected = string,
  Meta = Record<string, never>,
  E = never,
  R = never,
> {
  readonly name: string
  readonly scenarios: Effect.Effect<
    ReadonlyArray<Scenario<Input, Expected, Meta>>,
    E,
    R
  >
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * Create a dataset from an in-memory array of scenarios.
 * The simplest possible constructor — no effects, no requirements.
 */
export const fromArray = <Input, Expected, Meta = Record<string, never>>(
  name: string,
  scenarios: ReadonlyArray<Scenario<Input, Expected, Meta>>
): Dataset<Input, Expected, Meta> => ({
  name,
  scenarios: Effect_.succeed(scenarios),
})

/**
 * Create a dataset from an effectful loader.
 * Use this when scenarios come from disk, network, etc.
 */
export const fromEffect = <Input, Expected, Meta, E, R>(
  name: string,
  scenarios: Effect.Effect<ReadonlyArray<Scenario<Input, Expected, Meta>>, E, R>
): Dataset<Input, Expected, Meta, E, R> => ({
  name,
  scenarios,
})

// We need this import for the runtime `succeed` call, but we also want the
// namespace import above for the type. Effect's dual export style means we
// import the module value separately.
import { Effect as Effect_ } from 'effect'
