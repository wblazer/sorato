import { Schema } from 'effect'
import {
  getJsonWithSchema,
  setJsonWithSchema,
  storage,
  storageKey,
} from '$lib/storage.js'

const HISTORY_LIMIT = 100
const HistorySchema = Schema.Array(Schema.String)
const DraftAttachmentSchema = Schema.Struct({
  mediaType: Schema.String,
  fileName: Schema.String,
  data: Schema.String,
  size: Schema.Number,
})
const DraftAttachmentsSchema = Schema.Array(DraftAttachmentSchema)

export type ComposerDraftAttachment = typeof DraftAttachmentSchema.Type

export const composerDraftStorageKey = (
  connectionId: string | null | undefined,
  tabId: string | null | undefined,
) =>
  connectionId && tabId
    ? storageKey('connection', connectionId, 'tab', tabId, 'composer-draft')
    : null

export const composerHistoryStorageKey = (
  connectionId: string | null | undefined,
) =>
  connectionId
    ? storageKey('connection', connectionId, 'composer-history')
    : null

export function readComposerDraft(key: string | null | undefined): string | undefined {
  if (!key) return undefined
  return storage.get(key)
}

export function writeComposerDraft(
  key: string | null | undefined,
  value: string,
) {
  if (!key) return
  if (value.length === 0) {
    storage.remove(key)
    return
  }
  storage.set(key, value)
}

const attachmentsKey = (key: string) => `${key}:attachments`

export function readComposerDraftAttachments(
  key: string | null | undefined,
): ReadonlyArray<ComposerDraftAttachment> {
  if (!key) return []
  return getJsonWithSchema(attachmentsKey(key), DraftAttachmentsSchema, [])
}

export function writeComposerDraftAttachments(
  key: string | null | undefined,
  value: ReadonlyArray<ComposerDraftAttachment>,
) {
  if (!key) return
  if (value.length === 0) {
    storage.remove(attachmentsKey(key))
    return
  }
  setJsonWithSchema(attachmentsKey(key), DraftAttachmentsSchema, value)
}

export function readComposerHistory(
  key: string | null | undefined,
): ReadonlyArray<string> {
  if (!key) return []
  return getJsonWithSchema(key, HistorySchema, [])
}

export function pushComposerHistory(
  key: string | null | undefined,
  message: string,
) {
  const text = message.trim()
  if (!key || !text) return

  const current = readComposerHistory(key)
  if (current[0] === text) return
  setJsonWithSchema(key, HistorySchema, [text, ...current].slice(0, HISTORY_LIMIT))
}
