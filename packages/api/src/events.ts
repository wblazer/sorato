import { Schema } from 'effect'
import {
  MessageHeaderDisplaySchema,
  ToolResultDisplaySchema,
} from '@sorato/core/presentation'

export class StreamCursor extends Schema.Class<StreamCursor>('StreamCursor')({
  runId: Schema.String,
  eventId: Schema.Number,
}) {}

export const ServerEvent = Schema.Union([
  Schema.TaggedStruct('SessionUpdated', { sessionId: Schema.String }),
  Schema.TaggedStruct('MessagesAppended', { sessionId: Schema.String }),
  Schema.TaggedStruct('TextDelta', {
    sessionId: Schema.String,
    runId: Schema.String,
    delta: Schema.String,
    eventId: Schema.Number,
  }),
  Schema.TaggedStruct('ReasoningDelta', {
    sessionId: Schema.String,
    runId: Schema.String,
    delta: Schema.String,
    eventId: Schema.Number,
  }),
  Schema.TaggedStruct('ToolCall', {
    sessionId: Schema.String,
    runId: Schema.String,
    id: Schema.String,
    name: Schema.String,
    params: Schema.Unknown,
    header: Schema.optional(MessageHeaderDisplaySchema),
    eventId: Schema.Number,
  }),
  Schema.TaggedStruct('ToolResult', {
    sessionId: Schema.String,
    runId: Schema.String,
    id: Schema.String,
    name: Schema.String,
    result: Schema.String,
    header: Schema.optional(MessageHeaderDisplaySchema),
    bodyDisplay: Schema.optional(ToolResultDisplaySchema),
    isFailure: Schema.Boolean,
    eventId: Schema.Number,
  }),
  Schema.TaggedStruct('RunStart', {
    sessionId: Schema.String,
    runId: Schema.String,
    baseNodeId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct('RunEnd', {
    sessionId: Schema.String,
    runId: Schema.String,
  }),
  Schema.TaggedStruct('RunFailed', {
    sessionId: Schema.String,
    runId: Schema.String,
    message: Schema.String,
  }),
  Schema.TaggedStruct('ReplayReset', {
    sessionId: Schema.String,
    runId: Schema.String,
    reason: Schema.Literals([
      'run_completed',
      'run_failed',
      'replay_unavailable',
      'replay_gap',
    ]),
    refetch: Schema.Literal(true),
  }),
])

export type ServerEvent = typeof ServerEvent.Type
export type ContentEvent = Extract<
  ServerEvent,
  {
    readonly _tag: 'TextDelta' | 'ReasoningDelta' | 'ToolCall' | 'ToolResult'
  }
>

export function isContentEvent(event: ServerEvent): event is ContentEvent {
  return (
    event._tag === 'TextDelta' ||
    event._tag === 'ReasoningDelta' ||
    event._tag === 'ToolCall' ||
    event._tag === 'ToolResult'
  )
}
