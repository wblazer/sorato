import { Effect } from 'effect'
import type {
  MessageToolPreloader,
  MessagesApi,
} from '$lib/connection-services.js'

export interface StopMessageRefresh {
  readonly run: Effect.Effect<void, never, MessagesApi | MessageToolPreloader>
}

export const refreshMessagesAfterStop = (
  refresh: StopMessageRefresh,
  focusNodeId: string | undefined
) => refresh.run.pipe(Effect.map(() => focusNodeId))
