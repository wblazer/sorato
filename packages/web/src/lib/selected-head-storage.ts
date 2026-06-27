import { Schema } from 'effect'
import { storage, storageKey } from '$lib/storage.js'

const NodeHeadSchema = Schema.Struct({
  type: Schema.Literal('node'),
  nodeId: Schema.String,
})

const RunHeadSchema = Schema.Struct({
  type: Schema.Literal('run'),
  runId: Schema.String,
  baseNodeId: Schema.NullOr(Schema.String),
})

const SelectedHeadSchema = Schema.Union([
  Schema.Null,
  NodeHeadSchema,
  RunHeadSchema,
])
const SelectedHeadJsonSchema = Schema.fromJsonString(SelectedHeadSchema)

// Legacy storage used the bare node id string before selected run heads existed.
const LegacySelectedHeadSchema = Schema.Union([Schema.Null, Schema.String])
const LegacySelectedHeadJsonSchema = Schema.fromJsonString(
  LegacySelectedHeadSchema
)

export type SelectedHead = typeof SelectedHeadSchema.Type

export const selectedHeadChangedEvent = 'sorato:selected-head-changed'

export interface SelectedHeadChangedDetail {
  readonly key: string
  readonly head: SelectedHead
}

export function selectedHeadStorageKey(
  connectionId: string | null | undefined,
  sessionId: string,
  tabId: string
) {
  return storageKey(
    'connection',
    connectionId,
    'session',
    sessionId,
    'tab',
    tabId,
    'selected-head'
  )
}

export function readSelectedHead(
  key: string
):
  | { readonly exists: false }
  | { readonly exists: true; readonly value: SelectedHead } {
  const raw = storage.get(key)
  if (raw === undefined) return { exists: false }

  try {
    return {
      exists: true,
      value: Schema.decodeUnknownSync(SelectedHeadJsonSchema)(raw),
    }
  } catch {
    // Ignore and try the legacy bare-node-id format below.
  }

  try {
    const legacy = Schema.decodeUnknownSync(LegacySelectedHeadJsonSchema)(raw)
    return {
      exists: true,
      value: legacy === null ? null : { type: 'node', nodeId: legacy },
    }
  } catch {
    return { exists: false }
  }
}

export function writeSelectedHead(key: string, head: SelectedHead) {
  try {
    storage.set(key, Schema.encodeSync(SelectedHeadJsonSchema)(head))
  } catch {
    return
  }

  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<SelectedHeadChangedDetail>(selectedHeadChangedEvent, {
      detail: { key, head },
    })
  )
}
