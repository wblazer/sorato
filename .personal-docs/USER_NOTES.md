# User Notes

## Communication Style

- Keeps things concise, skims long responses — respect their time
- Appreciates whimsical/extravagant prose (Kit Langton style) but substance first
- Prefers to be asked important design questions upfront rather than having assumptions baked in silently
- Values "giving a shit" — thoughtful engineering over expedience

## Decision-Making

- Thinks in terms of composability and modularity (Bevy is a reference point)
- Prefers minimal core + extension points over rich opinionated defaults
- Wants room for future publishability but doesn't want premature abstraction
- Likes to keep things in one repo until there's a real reason to split

## Documentation Philosophy

- **Locality of concern**: things that drift together should be close to each other. Type explanations belong in comments next to the type, not in a separate doc. Tests near implementation. Structure, styling, and behavior colocated (why Tailwind + component frameworks win).
- **AGENTS.md nodes summarize folders, not files.** They explain _why_ the folder exists and point to files with one-line descriptions. Details live in the code itself — go read it.
- **Don't duplicate the code in docs.** If an explanation belongs next to a piece of code, put it there. Docs that restate what the code already says will drift and become lies.
- **Don't write low-value documentation that's likely to silently drift.** If a comment or doc restates something that lives elsewhere (a CLI invocation, a config value, a type signature), it will go stale when the source of truth changes — and nobody will trace the inconsistency back to your comment. Every piece of documentation should earn its keep.

## Technical Preferences

- Effect ecosystem (functional TypeScript)
- Bun runtime
- Strong typing — no `any` / `unknown` escape hatches
- Plain data + functions over classes/inheritance
- Dependencies via Effect Layers, not constructor injection
