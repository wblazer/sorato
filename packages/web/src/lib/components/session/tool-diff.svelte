<script lang="ts">
  import { FileDiff, type FileDiffMetadata } from '@pierre/diffs'
  import { onDestroy, onMount } from 'svelte'
  import type { ToolResultDisplay } from '$lib/types.js'
  import { parseToolDiff } from '$lib/tool-output.js'

  let { display }: { display: Extract<ToolResultDisplay, { type: 'diff' }> } =
    $props()

  let wrapper = $state<HTMLDivElement>()
  let fileDiff: FileDiffMetadata = $derived(parseToolDiff(display))
  let instance: FileDiff | undefined

  const renderOptions = {
    diffStyle: 'unified' as const,
    disableFileHeader: true,
    hunkSeparators: 'line-info-basic' as const,
    diffIndicators: 'bars' as const,
    overflow: 'scroll' as const,
    theme: {
      dark: 'pierre-dark' as const,
      light: 'pierre-light' as const,
    },
    themeType: 'system' as const,
    unsafeCSS: `
      :host {
        --diffs-gap-block: 0px;
        --diffs-scrollbar-gutter-override: 0px;
        --diffs-overflow-override: auto;
        --diffs-dark-bg: var(--inset);
        --diffs-light-bg: var(--inset);
        --diffs-dark-addition-color: var(--success-muted-foreground);
        --diffs-light-addition-color: var(--success-muted-foreground);
        --diffs-dark-deletion-color: var(--danger);
        --diffs-light-deletion-color: var(--danger);
      }

      [data-line-type="change-addition"] {
        background: color-mix(in oklch, var(--diffs-dark-addition-color) 22%, transparent);
      }

      [data-line-type="change-deletion"] {
        background: color-mix(in oklch, var(--diffs-dark-deletion-color) 18%, transparent);
      }

      [data-code] {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      [data-code]::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
      }

      [data-diff-span] {
        border-radius: 0.125rem;
        background: color-mix(in oklch, currentColor 18%, transparent);
      }
    `,
  }

  function renderDiff() {
    if (!wrapper) return
    instance ??= new FileDiff(renderOptions)
    instance.render({
      fileDiff,
      containerWrapper: wrapper,
      forceRender: true,
    })
  }

  onMount(() => {
    renderDiff()
  })

  $effect(() => {
    fileDiff
    renderDiff()
  })

  onDestroy(() => {
    instance?.cleanUp()
  })
</script>

<div bind:this={wrapper} class="tool-diff overflow-hidden"></div>

<style>
  .tool-diff {
    font-family: var(
      --font-mono,
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      'Liberation Mono',
      'Courier New',
      monospace
    );
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .tool-diff :global(diffs-container) {
    display: block;
  }
</style>
