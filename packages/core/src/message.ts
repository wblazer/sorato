import { Schema } from 'effect'
import { Prompt as PromptSchemas } from 'effect/unstable/ai'
import {
  MessageHeaderDisplaySchema,
  ToolResultDisplaySchema,
} from './tool/tool-output.ts'

export const SystemMessageSource = Schema.Literals([
  'system-prompt',
  'agents-md',
  'interruption',
])

export const StoredToolCallPart = Schema.Struct({
  ...PromptSchemas.ToolCallPart.fields,
  header: Schema.optionalKey(MessageHeaderDisplaySchema),
})

export const StoredToolResultPart = Schema.Struct({
  ...PromptSchemas.ToolResultPart.fields,
  header: Schema.optionalKey(MessageHeaderDisplaySchema),
  bodyDisplay: Schema.optionalKey(ToolResultDisplaySchema),
})

export const StoredPart = Schema.Union([
  PromptSchemas.TextPart,
  PromptSchemas.FilePart,
  PromptSchemas.ReasoningPart,
  StoredToolCallPart,
  StoredToolResultPart,
  PromptSchemas.ToolApprovalRequestPart,
  PromptSchemas.ToolApprovalResponsePart,
])

export const StoredSystemMessage = Schema.Struct({
  ...PromptSchemas.SystemMessage.fields,
  content: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(SystemMessageSource),
  display: Schema.optionalKey(MessageHeaderDisplaySchema),
  metadata: Schema.optionalKey(
    Schema.Struct({
      loaded: Schema.optionalKey(
        Schema.Struct({
          path: Schema.String,
        })
      ),
    })
  ),
})

export const StoredUserMessage = Schema.Struct({
  ...PromptSchemas.UserMessage.fields,
  content: Schema.Union([Schema.String, Schema.Array(StoredPart)]),
})

export const StoredAssistantMessage = Schema.Struct({
  ...PromptSchemas.AssistantMessage.fields,
  content: Schema.Union([Schema.String, Schema.Array(StoredPart)]),
})

export const StoredToolMessage = Schema.Struct({
  ...PromptSchemas.ToolMessage.fields,
  content: Schema.Array(
    Schema.Union([StoredToolResultPart, PromptSchemas.ToolApprovalResponsePart])
  ),
})

export const StoredMessage = Schema.Union([
  StoredSystemMessage,
  StoredUserMessage,
  StoredAssistantMessage,
  StoredToolMessage,
])

export type StoredMessageEncoded = typeof StoredMessage.Encoded
