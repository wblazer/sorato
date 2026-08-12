import type { MessagePart, ToolCallPart, ToolResultPart } from '$lib/types.js'

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanStep {
  readonly step: string
  readonly status: PlanStatus
}

export interface PlanSnapshot {
  readonly explanation: string | undefined
  readonly plan: ReadonlyArray<PlanStep>
}

export interface PlanProgress {
  readonly completed: number
  readonly total: number
  readonly activeStep: PlanStep | undefined
  readonly complete: boolean
}

const isPlanStatus = (value: unknown): value is PlanStatus =>
  value === 'pending' || value === 'in_progress' || value === 'completed'

const decodePlanStep = (value: unknown): PlanStep | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('step' in value) || !('status' in value)) return undefined
  if (typeof value.step !== 'string' || !isPlanStatus(value.status)) {
    return undefined
  }
  return { step: value.step, status: value.status }
}

export const decodePlanSnapshot = (
  value: unknown
): PlanSnapshot | undefined => {
  if (typeof value !== 'object' || value === null || !('plan' in value)) {
    return undefined
  }
  if (!Array.isArray(value.plan)) return undefined

  const plan = value.plan.flatMap((step) => {
    const decoded = decodePlanStep(step)
    return decoded === undefined ? [] : [decoded]
  })
  if (plan.length !== value.plan.length) return undefined

  const explanation =
    'explanation' in value && typeof value.explanation === 'string'
      ? value.explanation.trim() || undefined
      : undefined
  return { explanation, plan }
}

const isPlanCall = (part: MessagePart): part is ToolCallPart =>
  part.type === 'tool-call' && part.name === 'update_plan'

const isPlanResult = (part: MessagePart): part is ToolResultPart =>
  part.type === 'tool-result' && part.name === 'update_plan'

const latestSuccessfulPlan = (
  parts: ReadonlyArray<MessagePart>
): PlanSnapshot | undefined => {
  const calls = new Map<string, PlanSnapshot>()
  let latest: PlanSnapshot | undefined

  for (const part of parts) {
    if (isPlanCall(part)) {
      const plan = decodePlanSnapshot(part.params)
      if (plan !== undefined) calls.set(part.id, plan)
      continue
    }
    if (!isPlanResult(part) || part.isFailure) continue
    latest = calls.get(part.id) ?? latest
  }

  return latest
}

export const currentPlan = (
  persistedParts: ReadonlyArray<MessagePart>,
  streamingParts: ReadonlyArray<MessagePart>
): PlanSnapshot | undefined => {
  let latest = latestSuccessfulPlan(persistedParts)
  let pending: { readonly id: string; readonly plan: PlanSnapshot } | undefined

  for (const part of streamingParts) {
    if (isPlanCall(part)) {
      const plan = decodePlanSnapshot(part.params)
      if (plan !== undefined) pending = { id: part.id, plan }
      continue
    }
    if (!isPlanResult(part) || pending?.id !== part.id) continue
    if (!part.isFailure) latest = pending.plan
    pending = undefined
  }

  return pending?.plan ?? latest
}

export const planProgress = (snapshot: PlanSnapshot): PlanProgress => {
  const completed = snapshot.plan.filter(
    (step) => step.status === 'completed'
  ).length
  const activeStep =
    snapshot.plan.find((step) => step.status === 'in_progress') ??
    snapshot.plan.find((step) => step.status === 'pending') ??
    snapshot.plan.at(-1)

  return {
    completed,
    total: snapshot.plan.length,
    activeStep,
    complete: snapshot.plan.length > 0 && completed === snapshot.plan.length,
  }
}
