/**
 * Eval registry — the single place that maps names to runnable suites.
 *
 * Each eval folder exports a `suite` from its `eval.ts`. Register it here.
 * The CLI discovers available evals through this module.
 *
 * Why a static registry instead of dynamic filesystem discovery?
 * Dynamic discovery sounds elegant but requires async import(), loses
 * type safety, and makes dead code elimination impossible. A static
 * import list is boring and correct — and adding a new eval is one line.
 */
import type { EvalSuite } from './suite.ts'
import { suite as helloWorld } from './hello-world/eval.ts'
import { suite as fileEdit } from './file-edit/eval.ts'
import { suite as writeFile } from './write-file/eval.ts'
import { suite as glob } from './glob/eval.ts'

/** All registered eval suites, keyed by name. */
export const suites: ReadonlyArray<EvalSuite> = [
  helloWorld,
  fileEdit,
  writeFile,
  glob,
]

/** Look up a suite by name. Returns undefined if not found. */
export const findSuite = (name: string): EvalSuite | undefined =>
  suites.find((s) => s.name === name)
