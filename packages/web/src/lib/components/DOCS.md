# Components

Shared frontend building blocks for the web app.

## UI Composition Rules

- Prefer the local shadcn-style primitives in `src/lib/components/ui/` for interactive controls before reaching for raw HTML. If you need a clickable control, start with `Button`; if you need text entry, start with `Input`, `Textarea`, or `InputGroup`.
- Prefer the shared icon library (`phosphor-svelte`) over inline SVG markup. Icons should stay swappable, consistent in stroke/size, and easy to style through component props and utility classes.
- Raw `<button>`, `<input>`, `<textarea>`, or inline `<svg>` are still fine when a primitive genuinely cannot express the behavior, but treat that as the exception and keep the reason local and obvious in the code.

## Session UI

- `session/` owns the chat/session interaction surfaces. Keep composer, selectors, and recovery actions built from shared UI primitives so they match the rest of the app and inherit accessibility fixes from one place.

## Related Context

- `../../../DOCS.md` - package-level architecture and state ownership
