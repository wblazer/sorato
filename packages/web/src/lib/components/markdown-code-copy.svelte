<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import { createTimedAction } from '$lib/timed-action.svelte.js'
  import CheckIcon from 'phosphor-svelte/lib/CheckIcon'
  import CopyIcon from 'phosphor-svelte/lib/CopyIcon'
  import { onDestroy } from 'svelte'

  let { code }: { code: string } = $props()

  let tooltipOpen = $state(false)
  const copyAction = createTimedAction({
    successFor: 1200,
    run: () => navigator.clipboard.writeText(code),
  })
  const copied = $derived(copyAction.state === 'success')

  function handleCopy() {
    void copyAction.run().catch(() => {
      tooltipOpen = false
    })
  }

  $effect(() => {
    if (copyAction.state === 'success') {
      tooltipOpen = true
    } else if (copyAction.state === 'idle') {
      tooltipOpen = false
    }
  })

  onDestroy(copyAction.reset)
</script>

<span class="markdown-code-copy" data-not-typeset>
  <Tooltip.Root bind:open={tooltipOpen}>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-xs"
          class="text-muted-foreground hover:text-foreground"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onclick={handleCopy}
        >
          {#if copied}
            <CheckIcon />
          {:else}
            <CopyIcon />
          {/if}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{copied ? 'Copied' : 'Copy code'}</Tooltip.Content>
  </Tooltip.Root>
</span>
