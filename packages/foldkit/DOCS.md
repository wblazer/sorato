# Sorato Foldkit SPA

This package is an independent Foldkit rewrite of `@sorato/web`; it does not import Svelte or Svelte package internals.

## Architecture

- `src/main.ts` defines the Schema-backed `Model` and tagged `Message` union. `update` is the only state transition function and returns named Commands.
- `src/api.ts` uses the shared `@sorato/api` `HttpApi` contract with `HttpApiClient` and `BrowserHttpClient`. All network outcomes become Messages.
- `src/events.ts` owns scoped global-control and active-run EventSource Subscriptions. Changing the server URL or active run tears down the previous scoped source. SSE JSON is decoded with the shared `ServerEvent` schema before dispatch.
- `src/view.ts` is a pure, builder-injected view. It uses `@foldkit/ui` Button, Input, Textarea, and Select primitives and renders all server text as text nodes with `pre-wrap`—never HTML.
- Persisted transcript nodes retain their parent IDs and every node can be selected as the base for a branched send. Durable node batches replace matching nodes and advance the selected head.
- In development, the Scenario Lab discovers `/dev/scenarios` and lets a human activate, run, stop, branch, and summarize deterministic agent scenarios without provider credentials. It is omitted when the endpoint returns unavailable.

## Commands

```sh
bun run dev
bun run build
bun run typecheck
bun run test
```

The default server is `http://127.0.0.1:3100`. Change it in the top bar and reconnect. URL persistence is intentionally deferred: keeping browser storage out of pure update was preferred for this first functional slice.

## Testing

Scene tests cover loading, project/session selection, command success and failure, draft/send, disabled composition, and streamed text/reasoning/tool events via `Scene.Subscription.emit`. `events.test.ts` covers the pure stream coalescer. Vitest installs Foldkit matchers through `foldkit/test/vitest`.

Scenario scenes additionally cover dynamic scenario activation, one-click mock runs, production/unavailable mode, and background range compaction. The server's `dev` script enables the guarded scenario API; `start` leaves it disabled unless `SORATO_DEV_SCENARIOS=true` is explicitly supplied.
