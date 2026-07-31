import { Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@sorato/api'
import { MockAgentConfig } from './mock-agent.ts'

export const DevScenariosLive = HttpApiBuilder.group(
  Api,
  'devScenarios',
  (handlers) =>
    Effect.gen(function* () {
      const config = yield* MockAgentConfig
      return handlers
        .handle('status', () => config.status())
        .handle('activate', ({ params }) =>
          config
            .set(Option.some(params.scenario))
            .pipe(Effect.andThen(config.status()))
        )
        .handle('deactivate', () =>
          config.set(Option.none()).pipe(Effect.andThen(config.status()))
        )
    })
)
