import { BunRuntime, BunServices } from '@effect/platform-bun'
import { spawn } from 'node:child_process'
import { Command } from 'effect/unstable/cli'
import { Effect } from 'effect'

const version = '0.0.1'

const runProcess = (command: string, args: ReadonlyArray<string>) =>
  Effect.callback<void, Error>((resume) => {
    const child = spawn(command, [...args], {
      env: process.env,
      stdio: 'inherit',
    })

    child.once('error', (error) => resume(Effect.fail(error)))
    child.once('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
        return
      }

      if (code === null || code === 0) {
        resume(Effect.void)
        return
      }

      resume(Effect.fail(new Error(`${command} exited with code ${code}`)))
    })

    return Effect.sync(() => {
      if (!child.killed) child.kill()
    })
  })

const runDesktop = () => {
  const desktopBin = process.env.SORATO_DESKTOP_BIN?.trim()
  return desktopBin
    ? runProcess(desktopBin, [])
    : runProcess('bun', ['run', '--filter', '@sorato/desktop', 'start'])
}

const runServer = () => {
  const serverBin = process.env.SORATO_SERVER_BIN?.trim()
  return serverBin
    ? runProcess(serverBin, [])
    : runProcess('bun', ['run', '--filter', '@sorato/server', 'start'])
}

const desktop = Command.make('desktop', {}, runDesktop).pipe(
  Command.withDescription('Open the desktop app')
)

const serve = Command.make('serve', {}, runServer).pipe(
  Command.withDescription('Run the local HTTP server')
)

const cli = Command.make('sorato', {}, runDesktop).pipe(
  Command.withDescription('Run Sorato'),
  Command.withSubcommands([desktop, serve])
)

const program =
  process.argv.length <= 2 ? runDesktop() : Command.run(cli, { version })

program.pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
