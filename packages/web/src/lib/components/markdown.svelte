<script lang="ts">
  import { getAllContexts, mount, onDestroy, tick, unmount } from 'svelte'
  import { renderMarkdown } from '$lib/markdown.js'
  import MarkdownCodeCopy from '$lib/components/markdown-code-copy.svelte'
  import { highlightCode } from '$lib/syntax-highlighting.js'
  import type { ThemedToken } from '@pierre/diffs'

  let { text }: { text: string } = $props()

  const rendered = $derived(renderMarkdown(text))
  const context = getAllContexts()
  let root: HTMLDivElement | null = null
  let enhancementGeneration = 0
  let disposeControls: Array<() => void> = []

  function clearControls() {
    disposeControls.forEach((dispose) => dispose())
    disposeControls = []
  }

  function renderHighlightedCode(
    code: HTMLElement,
    lines: ReadonlyArray<ReadonlyArray<ThemedToken>>,
  ) {
    const fragment = document.createDocumentFragment()

    lines.forEach((line, lineIndex) => {
      line.forEach((token) => {
        const span = document.createElement('span')
        const fontStyle = token.fontStyle ?? 0

        span.textContent = token.content
        if (token.color !== undefined) span.style.color = token.color
        if ((fontStyle & 1) !== 0) span.style.fontStyle = 'italic'
        if ((fontStyle & 2) !== 0) span.style.fontWeight = '700'
        if ((fontStyle & 4) !== 0) span.style.textDecoration = 'underline'
        fragment.append(span)
      })

      if (lineIndex < lines.length - 1) fragment.append('\n')
    })

    code.replaceChildren(fragment)
    code.dataset.highlighted = ''
  }

  async function enhanceHighlighting(
    code: HTMLElement,
    source: string,
    language: string,
    generation: number,
    content: string,
  ) {
    const highlighted = await highlightCode(source, language)
    if (highlighted === undefined) return
    if (generation !== enhancementGeneration || content !== rendered) return
    if (!code.isConnected) return

    renderHighlightedCode(code, highlighted)
  }

  async function enhanceCodeControls(content: string) {
    const generation = ++enhancementGeneration
    await tick()
    if (generation !== enhancementGeneration || content !== rendered) return
    if (root === null) return

    clearControls()
    root
      .querySelectorAll<HTMLElement>('.markdown-code-block')
      .forEach((block) => {
        const target = block.querySelector<HTMLElement>(
          '[data-markdown-copy-mount]',
        )
        const codeElement = block.querySelector<HTMLElement>('code')
        const language = block.dataset.language
        const code = codeElement?.textContent
        if (
          target === null ||
          codeElement === null ||
          language === undefined ||
          code === undefined ||
          code === null
        )
          return

        const control = mount(MarkdownCodeCopy, {
          target,
          context,
          props: { code },
        })
        disposeControls.push(() => {
          void unmount(control)
        })

        void enhanceHighlighting(
          codeElement,
          code,
          language,
          generation,
          content,
        )
      })
  }

  $effect(() => {
    void enhanceCodeControls(rendered)
  })

  onDestroy(() => {
    enhancementGeneration += 1
    clearControls()
  })
</script>

<div bind:this={root} class="typeset typeset-chat" data-markdown>
  {@html rendered}
</div>
