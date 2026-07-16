<script lang="ts">
  import Markdown from '$lib/components/markdown.svelte'
  import Button from '$lib/components/ui/button/button.svelte'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import { Textarea } from '$lib/components/ui/textarea/index.js'
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon'

  let { onClose }: { onClose: () => void } = $props()

  const fixtures = [
    {
      name: 'Kitchen sink',
      source: [
        '# Markdown rendering',
        '',
        'Agent responses support **strong text**, *emphasis*, ~~corrections~~, `inlineCode()`, and [external links](https://effect.website).',
        '',
        '## Structured content',
        '',
        '- Lists keep a readable rhythm',
        '  - Nested items remain compact',
        '- Long paths wrap safely: `/home/sorato/packages/web/src/lib/components/a-very-long-component-name-that-must-not-overflow.svelte`',
        '',
        '1. Parse untrusted Markdown',
        '2. Render semantic HTML',
        '3. Apply the shared typeset',
        '',
        '- [x] Raw HTML is disabled',
        '- [x] Fenced code uses shared Shiki syntax highlighting',
        '',
        '> Correctness comes from handling content as untrusted at the rendering boundary.',
        '',
        '| Surface | Behavior | Narrow screens |',
        '| --- | --- | --- |',
        '| Tables | Semantic rows and columns | Scroll horizontally |',
        '| Code | Preserves whitespace | Scroll horizontally |',
        '',
        '```ts',
        'const program = Effect.gen(function* () {',
        '  const workspace = yield* Workspace',
        '  return yield* workspace.open("/tmp/example")',
        '})',
        '```',
        '',
        '---',
        '',
        'Raw HTML remains text: <button onclick="alert(1)">not interactive</button>',
      ].join('\n'),
    },
    {
      name: 'Streaming edges',
      source: [
        '## Work in progress',
        '',
        'Earlier blocks keep their spacing while new blocks append.',
        '',
        '- first result',
        '- second result',
        '',
        '```rust',
        'pub enum Status {',
        '    Ready,',
        '    Running { step: usize },',
      ].join('\n'),
    },
    {
      name: 'Overflow',
      source: [
        '### Adversarial width',
        '',
        '`https://example.test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`',
        '',
        '| Extremely long diagnostic name | Unbroken value | Another column |',
        '| --- | --- | --- |',
        '| provider.authentication.configuration | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` | Content stays reachable |',
        '',
        '```text',
        'this-is-an-intentionally-long-line-without-breaks-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '```',
      ].join('\n'),
    },
  ] as const

  let selectedFixture = $state<string>(fixtures[0].name)
  let source = $state<string>(fixtures[0].source)

  function selectFixture(fixture: (typeof fixtures)[number]) {
    selectedFixture = fixture.name
    source = fixture.source
  }
</script>

<svelte:head>
  <title>Markdown playground · Sorato</title>
</svelte:head>

<div class="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
  <header
    class="flex shrink-0 items-center gap-3 border-b border-border px-3 py-3 sm:px-5"
  >
    <Button
      variant="ghost"
      size="icon"
      aria-label="Leave Markdown playground"
      onclick={onClose}
    >
      <ArrowLeftIcon />
    </Button>
    <div class="min-w-0">
      <h1 class="text-base font-medium">Markdown playground</h1>
      <p class="truncate text-sm text-muted-foreground">
        Production renderer with deterministic fixtures. Edit the source to test
        streaming fragments and edge cases.
      </p>
    </div>
  </header>

  <nav
    class="flex shrink-0 flex-wrap gap-1 border-b border-border bg-inset px-3 py-2 sm:px-5"
    aria-label="Markdown fixtures"
  >
    {#each fixtures as fixture (fixture.name)}
      <Button
        variant={selectedFixture === fixture.name ? 'outline' : 'ghost'}
        size="sm"
        onclick={() => selectFixture(fixture)}
      >
        {fixture.name}
      </Button>
    {/each}
  </nav>

  <main
    class="grid min-h-0 flex-1 grid-rows-[minmax(12rem,0.8fr)_minmax(12rem,1.2fr)] md:grid-cols-2 md:grid-rows-1"
  >
    <section
      class="flex min-h-0 flex-col border-b border-border md:border-r md:border-b-0"
    >
      <div
        class="border-b border-border bg-surface px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Markdown source
      </div>
      <Textarea
        bind:value={source}
        aria-label="Markdown source"
        spellcheck={false}
        class="field-sizing-fixed h-full min-h-0 flex-1 resize-none rounded-none border-0 bg-inset p-3 font-mono text-xs/relaxed focus-visible:border-0 focus-visible:ring-0 sm:p-5"
        oninput={() => (selectedFixture = '')}
      />
    </section>

    <section class="flex min-h-0 min-w-0 flex-col">
      <div
        class="border-b border-border bg-surface px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Agent message preview
      </div>
      <ScrollArea class="min-h-0 flex-1" viewportClass="p-4 sm:p-8">
        <div class="mx-auto w-full max-w-3xl">
          <Markdown text={source} />
        </div>
      </ScrollArea>
    </section>
  </main>
</div>
