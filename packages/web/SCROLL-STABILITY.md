# Scroll stability diagnostics

This harness reproduces streamed-response geometry and scroll-intent transitions
without a server or model call. It uses the production Markdown renderer,
`ScrollArea`, and `MessageScrollerController` with deterministic long history,
code, tool-style output, stream growth, completion replacement, and
shrink/regrowth controls.

## Run it

```bash
bunx playwright install chromium
bun run --filter @sorato/web test:e2e
```

For interactive diagnosis, run the standalone fixture and open
`/scroll-stability.html`:

```bash
bun --bun vite --config vite.scroll-stability.config.ts
```

Add `?contain=1` to restore the removed transcript-row
`content-visibility:auto` and `contain-intrinsic-size:auto 10rem` behavior for a
before/after comparison. In the normal development app, the fixture is also
available from **Open Scroll Stability Diagnostics** in the command palette.

## Invariants

- Geometry changes never grant permission to follow the bottom.
- A reader leaves follow mode through an upward gesture and resumes only after
  an owned, downward user gesture reaches the bottom (or an explicit jump).
- Gestures from nested scroll areas do not affect the transcript scroller.
- A streamed-to-durable replacement keeps the same logical reading position.
- When a native content clamp is unavoidable, later growth causes no controller
  scroll write unless the reader resumed following.
- Transcript row geometry is real and stable; no shared guessed row height is
  substituted for heterogeneous Markdown and tool output.

## Evidence log

Measured in Chromium 151 at baseline commit `ac53bd5` on 2026-08-06:

| Scenario                                                                        |                                                                Before |                                                       After |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------: | ----------------------------------------------------------: |
| Completion shrink clamps a free reader to `scrollTop=230`, then content regrows |                                            Controller pulled to `400` |         Remained `230` in the deterministic controller test |
| Cold variable-height rows become relevant                                       | `scrollHeight` changed by `4,337px` with the 10rem intrinsic estimate |                         `0px` change with normal row layout |
| Exact streamed-to-durable response replacement while reading                    |                                              Not separately protected |        `0px` scroll-top delta and `0px` reader-marker delta |
| Native shrink/clamp/regrowth                                                    |                    Geometry can move through browser scroll anchoring | `0` controller scroll writes; mode remains `free-scrolling` |

The browser test reports native anchoring separately from controller writes. In
the synthetic shrink/regrowth case Chromium moved `scrollTop` by `2,201px` to
preserve its native content anchor, while the controller issued zero writes.
This distinction prevents a legitimate browser anchor adjustment from being
misdiagnosed as application autoscroll.

The Playwright tests attach machine-readable `reader-position-evidence`,
`clamp-regrowth-evidence`, and `scroll-geometry-evidence` annotations for
annotation-aware reporters and future comparisons.
