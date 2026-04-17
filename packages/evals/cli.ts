/**
 * agents CLI — run and inspect eval suites.
 *
 * Usage:
 *   bun run cli.ts run hello-world
 *   bun run cli.ts list
 */
import { Argument, Command } from 'effect/unstable/cli'
import { BunRuntime, BunServices } from '@effect/platform-bun'
import { Console, Effect, Match } from 'effect'
import { suites, findSuite } from './registry.ts'

// ---------------------------------------------------------------------------
// `list` — show available eval suites
// ---------------------------------------------------------------------------

const noSuitesRegistered = Console.log('No eval suites registered.')

const listSuites = Effect.gen(function* () {
  yield* Console.log('Available eval suites:\n')
  for (const suite of suites) {
    yield* Console.log(`  ${suite.name}`)
    yield* Console.log(`    ${suite.description}\n`)
  }
})

const list = Command.make('list', {}, () =>
  Match.value(suites.length).pipe(
    Match.when(0, () => noSuitesRegistered),
    Match.orElse(() => listSuites)
  )
)

// ---------------------------------------------------------------------------
// `run` — execute an eval suite by name
// ---------------------------------------------------------------------------

const evalName = Argument.string('eval').pipe(
  Argument.withDescription('Name of the eval suite to run')
)

const run = Command.make('run', { evalName }, ({ evalName }) =>
  Match.value(findSuite(evalName)).pipe(
    Match.when(undefined, () =>
      Effect.gen(function* () {
      yield* Console.error(`Unknown eval suite: '${evalName}'`)
      yield* Console.error(`Run 'list' to see available suites.`)
      })
    ),
    Match.orElse((suite) =>
      Effect.gen(function* () {
        yield* Console.log(`Running eval: ${suite.name}`)
        yield* Console.log(`${'─'.repeat(50)}`)
        yield* suite.run
      })
    )
  )
)

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

const agents = Command.make('agents', {}).pipe(
  Command.withSubcommands([list, run])
)

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const cli = Command.run(agents, {
  version: '0.0.1',
})

cli.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
