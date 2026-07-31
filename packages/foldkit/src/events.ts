import { ServerEvent } from '@sorato/api'
import type { ServerEvent as ServerEventType } from '@sorato/api'
import { Effect, Queue, Schema, Scope, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { m } from 'foldkit/message'
import { PointerInteractionsEnded, ViewportResized } from './browser.ts'
import type { Message, Model } from './main.ts'

export const ReceivedServerEvent = m('ReceivedServerEvent', {
  event: ServerEvent,
})

const eventTags = [
  'ActiveRunUpserted',
  'SessionTitleUpdated',
  'NodeBatchCommitted',
  'TextDelta',
  'ReasoningDelta',
  'ToolCall',
  'ToolResult',
  'RunStart',
  'RunEnd',
  'RunBaseUpdated',
  'RunRetrying',
  'RunFailed',
  'ReplayReset',
] as const

const decodeEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(ServerEvent)
)

export const eventStream = (
  baseUrl: string,
  runId?: string
): Stream.Stream<Message> =>
  Stream.callback<Message>((queue) =>
    Effect.gen(function* () {
      const url = new URL('/events', baseUrl)
      if (runId !== undefined) url.searchParams.set('runId', runId)
      const source = new EventSource(url)
      let lastContentEventId = 0
      source.addEventListener('terminal', () => {
        Queue.endUnsafe(queue)
        source.close()
      })
      for (const tag of eventTags) {
        source.addEventListener(
          tag,
          (message: globalThis.MessageEvent<string>) => {
            const decoded = decodeEvent(message.data)
            if (decoded._tag !== 'Some') return
            const event = decoded.value
            if ('eventId' in event && event.eventId <= lastContentEventId)
              return
            if ('eventId' in event) lastContentEventId = event.eventId
            Queue.offerUnsafe(queue, ReceivedServerEvent({ event }))
            if (
              runId !== undefined &&
              (event._tag === 'RunEnd' || event._tag === 'ReplayReset')
            ) {
              Queue.endUnsafe(queue)
              source.close()
            }
          }
        )
      }
      const scope = yield* Scope.Scope
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => source.close())
      )
    })
  ).pipe(Stream.catchCause(() => Stream.empty))

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  viewport: Subscription.persistent(
    Subscription.fromEvent<UIEvent, Message>({
      target: () => window,
      type: 'resize',
      toMessage: () => ViewportResized({ width: window.innerWidth }),
    })
  ),
  interactionPointerUp: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active:
          model.resizing !== null || model.compactDragStartNodeId !== null,
      }),
      dependenciesToStream: ({ active }) =>
        active
          ? Subscription.fromEvent<PointerEvent, Message>({
              target: () => window,
              type: 'pointerup',
              toMessage: () => PointerInteractionsEnded(),
            })
          : Stream.empty,
    }
  ),
  interactionPointerCancel: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active:
          model.resizing !== null || model.compactDragStartNodeId !== null,
      }),
      dependenciesToStream: ({ active }) =>
        active
          ? Subscription.fromEvent<PointerEvent, Message>({
              target: () => window,
              type: 'pointercancel',
              toMessage: () => PointerInteractionsEnded(),
            })
          : Stream.empty,
    }
  ),
  interactionBlur: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active:
          model.resizing !== null || model.compactDragStartNodeId !== null,
      }),
      dependenciesToStream: ({ active }) =>
        active
          ? Subscription.fromEvent<FocusEvent, Message>({
              target: () => window,
              type: 'blur',
              toMessage: () => PointerInteractionsEnded(),
            })
          : Stream.empty,
    }
  ),
  serverEvents: entry(
    { baseUrl: Schema.String, enabled: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        baseUrl: model.baseUrl,
        enabled: model.status === 'ready',
      }),
      dependenciesToStream: ({ baseUrl, enabled }) =>
        enabled ? eventStream(baseUrl) : Stream.empty,
    }
  ),
  runEvents: entry(
    { baseUrl: Schema.String, runId: Schema.NullOr(Schema.String) },
    {
      modelToDependencies: (model) => ({
        baseUrl: model.baseUrl,
        runId: model.activeRunId,
      }),
      dependenciesToStream: ({ baseUrl, runId }) =>
        runId === null ? Stream.empty : eventStream(baseUrl, runId),
    }
  ),
  compactionEvents: entry(
    { baseUrl: Schema.String, runId: Schema.NullOr(Schema.String) },
    {
      modelToDependencies: (model) => ({
        baseUrl: model.baseUrl,
        runId: model.compactingRunId,
      }),
      dependenciesToStream: ({ baseUrl, runId }) =>
        runId === null ? Stream.empty : eventStream(baseUrl, runId),
    }
  ),
}))

export interface StreamActivity {
  readonly id: string
  readonly kind: 'text' | 'reasoning' | 'tool-call' | 'tool-result'
  readonly title: string
  readonly body: string
  readonly failed: boolean
  readonly chunks: ReadonlyArray<{
    readonly eventId: number
    readonly body: string
  }>
}

const printable = (value: unknown): string => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return '[unprintable value]'
  }
}

export const applyContentEvent = (
  activity: ReadonlyArray<StreamActivity>,
  event: ServerEventType
): ReadonlyArray<StreamActivity> => {
  switch (event._tag) {
    case 'TextDelta': {
      const prior = activity.find((item) => item.id === `text:${event.runId}`)
      return prior
        ? activity.map((item) =>
            item.id === prior.id
              ? {
                  ...item,
                  body: item.body + event.delta,
                  chunks: [
                    ...item.chunks,
                    { eventId: event.eventId, body: event.delta },
                  ],
                }
              : item
          )
        : [
            ...activity,
            {
              id: `text:${event.runId}`,
              kind: 'text',
              title: 'Assistant',
              body: event.delta,
              failed: false,
              chunks: [{ eventId: event.eventId, body: event.delta }],
            },
          ]
    }
    case 'ReasoningDelta': {
      const prior = activity.find(
        (item) => item.id === `reasoning:${event.runId}`
      )
      return prior
        ? activity.map((item) =>
            item.id === prior.id
              ? {
                  ...item,
                  body: item.body + event.delta,
                  chunks: [
                    ...item.chunks,
                    { eventId: event.eventId, body: event.delta },
                  ],
                }
              : item
          )
        : [
            ...activity,
            {
              id: `reasoning:${event.runId}`,
              kind: 'reasoning',
              title: 'Reasoning',
              body: event.delta,
              failed: false,
              chunks: [{ eventId: event.eventId, body: event.delta }],
            },
          ]
    }
    case 'ToolCall':
      return [
        ...activity,
        {
          id: `call:${event.id}`,
          kind: 'tool-call',
          title: `Tool call · ${event.name}`,
          body: printable(event.params),
          failed: false,
          chunks: [{ eventId: event.eventId, body: printable(event.params) }],
        },
      ]
    case 'ToolResult':
      return [
        ...activity,
        {
          id: `result:${event.id}`,
          kind: 'tool-result',
          title: `Tool result · ${event.name}`,
          body: event.result,
          failed: event.isFailure,
          chunks: [{ eventId: event.eventId, body: event.result }],
        },
      ]
    default:
      return activity
  }
}

export const acknowledgeActivityThrough = (
  activity: ReadonlyArray<StreamActivity>,
  eventId: number
): ReadonlyArray<StreamActivity> =>
  activity.flatMap((item) => {
    const chunks = item.chunks.filter((chunk) => chunk.eventId > eventId)
    return chunks.length === 0
      ? []
      : [{ ...item, chunks, body: chunks.map((chunk) => chunk.body).join('') }]
  })
