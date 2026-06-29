<script lang="ts">
  import { FileDiff, type FileDiffMetadata } from '@pierre/diffs'
  import type { ToolResultDisplay } from '$lib/types.js'
  import { parseToolDiff, toolDiffTheme } from '$lib/tool-output.js'

  let { display, cacheKey }: { display: ToolResultDisplay; cacheKey: string } =
    $props()

  interface RenderInput {
    readonly fileDiff: FileDiffMetadata
    readonly cacheKey: string
  }

  const renderInput: RenderInput = $derived({
    fileDiff: parseToolDiff(display, cacheKey),
    cacheKey,
  })

  const renderOptions = {
    diffStyle: 'unified' as const,
    disableFileHeader: true,
    hunkSeparators: 'simple' as const,
    diffIndicators: 'bars' as const,
    overflow: 'scroll' as const,
    theme: toolDiffTheme,
    themeType: 'system' as const,
    lineDiffType: 'none' as const,
    maxLineDiffLength: 1000,
    maxLineLengthForHighlighting: 1000,
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
    `,
  }

  function renderDiff(
    wrapper: HTMLDivElement,
    instance: FileDiff,
    input: RenderInput,
  ) {
    instance.render({
      fileDiff: input.fileDiff,
      containerWrapper: wrapper,
      forceRender: true,
    })
  }

  function diffRenderer(wrapper: HTMLDivElement, input: RenderInput) {
    const instance = new FileDiff(renderOptions)
    let renderedCacheKey = input.cacheKey
    renderDiff(wrapper, instance, input)

    return {
      update(next: RenderInput) {
        if (next.cacheKey === renderedCacheKey) return

        renderedCacheKey = next.cacheKey
        renderDiff(wrapper, instance, next)
      },
      destroy() {
        instance.cleanUp()
      },
    }
  }
</script>

<div use:diffRenderer={renderInput} class="tool-diff overflow-hidden"></div>

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
