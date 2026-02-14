# Learn - Update Agent Map

When the user invokes `/learn`, help them update the DOCS.md nodes with learnings from the current session. The root AGENTS.md stays as-is; all subdirectory documentation nodes use DOCS.md.

## Your Task

1. **Analyze the session**: Review what files were changed, what was built, what problems were solved
2. **Identify relevant DOCS.md nodes**: Determine which node(s) should capture these learnings
3. **Categorize the learning**:
   - **Obvious/Trivial**: File moves, new commands, dependency additions → Update automatically
   - **Significant**: New patterns, architecture decisions, pitfalls, "never do" rules → Ask user for approval
4. **Update the nodes**: Apply changes (auto or with approval)
5. **Show summary**: Present what was updated

## What to Capture

- New project structure (directories, major files)
- New commands or scripts
- New dependencies or tools
- New patterns established
- Problems solved that others might hit
- Architecture decisions
- "Never do" rules discovered
- API/library usage examples worth documenting

## How to Handle Updates

**Automatic updates** (don't ask, just do it):

- Adding a new node link to Map Navigation section
- Updating command examples
- Adding new dependencies to tech stack
- Documenting new file locations

**Ask before updating**:

- New "Never Do" rules
- Common pitfalls
- Pattern examples
- Architecture guidance
- "Why does this exist" explanations

## Process

1. Check git status or recent changes to understand the session
2. Find all DOCS.md files in the project (and the root AGENTS.md)
3. For each relevant node, determine what needs updating
4. For trivial changes: propose the edit and execute
5. For significant changes: explain what you want to add and ask "Should I add this to DOCS.md?"
6. After all updates, summarize what was captured

## Example Interaction

If the user just created a new database module:

**Automatic**: "I'll add a link to `src/db/DOCS.md` in the root Map Navigation section."

**Ask**: "I noticed you established a pattern of always using transactions for multi-table operations. Should I document this as a best practice in `src/db/DOCS.md`?"

## Output Format

Present changes as:

- What was updated automatically
- What was suggested and user response
- Any follow-up recommendations
