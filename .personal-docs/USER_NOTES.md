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

## Technical Preferences

- Effect ecosystem (functional TypeScript)
- Bun runtime
- Strong typing — no `any` / `unknown` escape hatches
- Plain data + functions over classes/inheritance
- Dependencies via Effect Layers, not constructor injection
