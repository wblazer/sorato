<script lang="ts">
  import { FileDiff, type FileDiffMetadata } from '@pierre/diffs'
  import type { ToolResultDisplay } from '$lib/types.js'
  import { parseToolDiff, toolDiffTheme } from '$lib/tool-output.js'

  let { display }: { display: Extract<ToolResultDisplay, { type: 'diff' }> } =
    $props()

  let fileDiff: FileDiffMetadata = $derived(parseToolDiff(display))

  const renderOptions = {
    diffStyle: 'unified' as const,
    disableFileHeader: true,
    hunkSeparators: 'line-info-basic' as const,
    diffIndicators: 'bars' as const,
    overflow: 'scroll' as const,
    theme: toolDiffTheme,
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

  function renderDiff(wrapper: HTMLDivElement, instance: FileDiff) {
    instance.render({
      fileDiff,
      containerWrapper: wrapper,
      forceRender: true,
    })
  }

  function diffRenderer(wrapper: HTMLDivElement, _fileDiff: FileDiffMetadata) {
    const instance = new FileDiff(renderOptions)
    renderDiff(wrapper, instance)

    return {
      update() {
        renderDiff(wrapper, instance)
      },
      destroy() {
        instance.cleanUp()
      },
    }
  }
</script>

<div use:diffRenderer={fileDiff} class="tool-diff overflow-hidden"></div>

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
