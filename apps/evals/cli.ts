/**
 * agents CLI — run and inspect eval suites.
 *
 * Usage:
 *   bun run cli.ts run hello-world
 *   bun run cli.ts list
 */
import { Args, Command } from '@effect/cli'
import { BunContext, BunRuntime } from '@effect/platform-bun'
import { Console, Effect } from 'effect'
import { suites, findSuite } from './registry.ts'

// ---------------------------------------------------------------------------
// `list` — show available eval suites
// ---------------------------------------------------------------------------

const list = Command.make('list', {}, () =>
  Effect.gen(function* () {
    if (suites.length === 0) {
      yield* Console.log('No eval suites registered.')
      return
    }

    yield* Console.log('Available eval suites:\n')
    for (const suite of suites) {
      yield* Console.log(`  ${suite.name}`)
      yield* Console.log(`    ${suite.description}\n`)
    }
  })
)

// ---------------------------------------------------------------------------
// `run` — execute an eval suite by name
// ---------------------------------------------------------------------------

const evalName = Args.text({ name: 'eval' }).pipe(
  Args.withDescription('Name of the eval suite to run')
)

const run = Command.make('run', { evalName }, ({ evalName }) =>
  Effect.gen(function* () {
    const suite = findSuite(evalName)
    if (!suite) {
      yield* Console.error(`Unknown eval suite: '${evalName}'`)
      yield* Console.error(`Run 'list' to see available suites.`)
      return
    }

    yield* Console.log(`Running eval: ${suite.name}`)
    yield* Console.log(`${'─'.repeat(50)}`)

    yield* suite.run
  })
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
  name: 'agents',
  version: '0.0.1',
})

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
