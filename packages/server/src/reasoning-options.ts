/**
 * Derives reasoning/thinking UI options and provider requests from the
 * per-model `reasoningOptions` captured from models.dev — the single source of
 * truth. Nothing here is keyed on model ids; every decision flows from the
 * upstream catalog so the options stay correct as models.dev updates.
 *
 * Three control shapes are handled:
 *   - `effort`  — a discrete enum (OpenAI, newer Anthropic). The selected level
 *     is passed straight through to the provider effort, no clamping.
 *   - `budget`  — a token range (classic Anthropic). Turned into a named ladder
 *     so the UI keeps using a single select; each rung maps to a token budget.
 *   - `toggle`  — an on/off knob (no supported provider uses it today, but it is
 *     still surfaced as an on/off select rather than a separate UI path).
 */
import { MODEL_PROVIDERS } from './models.generated.ts'

export type ThinkingLevel =
  | 'off'
  | 'on'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

/** Normalized reasoning control as captured in `models.generated.ts`. */
export type ReasoningOption =
  | { readonly type: 'effort'; readonly values: ReadonlyArray<string> }
  | { readonly type: 'budget'; readonly min: number; readonly max?: number }
  | { readonly type: 'toggle' }

/** Resolved provider request for a selected level. */
export type ReasoningRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'effort'; readonly effort: string }
  | { readonly kind: 'budget'; readonly budgetTokens: number }

// Display/sort order for the select. Lower ranks render first.
const RANK: Record<ThinkingLevel, number> = {
  off: 0,
  on: 1,
  minimal: 2,
  low: 3,
  medium: 4,
  high: 5,
  xhigh: 6,
  max: 7,
}

// Named token-budget ladder for `budget`-type models, sized after pi's rungs.
// `off` is handled separately (reasoning disabled). `xhigh`/`max` are not part
// of the budget ladder — those only exist as discrete efforts.
const BUDGET_LADDER = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
} as const satisfies Partial<Record<ThinkingLevel, number>>

const BUDGET_RUNGS = ['minimal', 'low', 'medium', 'high'] as const

const KNOWN_LEVELS = new Set<string>(Object.keys(RANK))

/**
 * Map a models.dev effort value onto a `ThinkingLevel`. `none` collapses to our
 * `off`. Unknown future values return `undefined` and are simply not surfaced
 * until the union is extended (rather than crashing schema encoding).
 */
const effortToLevel = (value: string): ThinkingLevel | undefined => {
  if (value === 'none') return 'off'
  return KNOWN_LEVELS.has(value) ? (value as ThinkingLevel) : undefined
}

const sortLevels = (
  levels: Iterable<ThinkingLevel>
): ReadonlyArray<ThinkingLevel> =>
  [...new Set(levels)].sort((a, b) => RANK[a] - RANK[b])

const findEffort = (options: ReadonlyArray<ReasoningOption>) =>
  options.find((option) => option.type === 'effort')
const findBudget = (options: ReadonlyArray<ReasoningOption>) =>
  options.find((option) => option.type === 'budget')
const findToggle = (options: ReadonlyArray<ReasoningOption>) =>
  options.find((option) => option.type === 'toggle')

/**
 * Compute the thinking levels to surface in the UI for a model, derived purely
 * from its captured `reasoningOptions`.
 */
export const thinkingLevelsFor = (
  reasoningOptions: ReadonlyArray<ReasoningOption>,
  reasoning: boolean
): ReadonlyArray<ThinkingLevel> => {
  if (!reasoning) return ['off']

  const effort = findEffort(reasoningOptions)
  const budget = findBudget(reasoningOptions)
  const toggle = findToggle(reasoningOptions)
  const levels = new Set<ThinkingLevel>()

  if (effort !== undefined) {
    for (const value of effort.values) {
      const level = effortToLevel(value)
      if (level !== undefined) levels.add(level)
    }
    // Dual effort+budget models can still disable thinking via the budget knob.
    if (budget !== undefined) levels.add('off')
  } else if (budget !== undefined) {
    levels.add('off')
    for (const rung of BUDGET_RUNGS) {
      const tokens = BUDGET_LADDER[rung]
      if (
        tokens >= budget.min &&
        (budget.max === undefined || tokens <= budget.max)
      ) {
        levels.add(rung)
      }
    }
  } else if (toggle !== undefined) {
    levels.add('off')
    levels.add('on')
  } else {
    // Reasoning model with no structured control: allow disabling only.
    levels.add('off')
  }

  if (levels.size === 0) levels.add('off')
  return sortLevels(levels)
}

/**
 * Resolve a selected level into a concrete provider request. The selected level
 * is trusted: for `effort` models it is passed straight through (it can only be
 * one of the model's own values), and `off` disables thinking — via an explicit
 * `none` effort when the model supports it, otherwise by omitting it.
 */
export const resolveReasoning = (
  reasoningOptions: ReadonlyArray<ReasoningOption>,
  level: ThinkingLevel | undefined
): ReasoningRequest => {
  const effort = findEffort(reasoningOptions)
  const budget = findBudget(reasoningOptions)

  if (level === undefined || level === 'off' || level === 'on') {
    if (level === 'off' && effort?.values.includes('none')) {
      return { kind: 'effort', effort: 'none' }
    }
    return { kind: 'none' }
  }

  if (effort !== undefined) return { kind: 'effort', effort: level }

  if (budget !== undefined) {
    const tokens = (BUDGET_LADDER as Record<string, number>)[level]
    return tokens === undefined
      ? { kind: 'none' }
      : { kind: 'budget', budgetTokens: tokens }
  }

  return { kind: 'none' }
}

/** Look up a model's captured reasoning options by provider + bare model id. */
export const reasoningOptionsOf = (
  providerId: string,
  modelId: string
): ReadonlyArray<ReasoningOption> =>
  (MODEL_PROVIDERS.find((provider) => provider.id === providerId)?.models.find(
    (model) => model.id === modelId
  )?.capabilities.reasoningOptions as
    | ReadonlyArray<ReasoningOption>
    | undefined) ?? []
