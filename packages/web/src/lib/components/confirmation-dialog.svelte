<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js'
  import Button from '$lib/components/ui/button/button.svelte'
  import * as Item from '$lib/components/ui/item/index.js'
  import { confirmationStore } from '$lib/stores/confirmation.svelte.js'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'

  const state = $derived(confirmationStore.state)
  const actionLabel = $derived.by(() => {
    const label = state.action?.label
    return typeof label === 'function' ? label(state.actionPending) : label
  })

  function handleCancel() {
    if (state.actionPending) return

    state.onCancel?.()
    confirmationStore.closeConfirmation()
  }

  function handleOpenChange(open: boolean) {
    if (!open) handleCancel()
  }

  function handleAnimationEnd() {
    if (!state.open) confirmationStore.resetConfirmation()
  }

  function handleAction() {
    state.action?.run({
      close: confirmationStore.closeConfirmation,
      setError: confirmationStore.setActionError,
      setPending: confirmationStore.setActionPending,
    })
  }
</script>

<AlertDialog.Root open={state.open} onOpenChange={handleOpenChange}>
  <AlertDialog.Content onanimationend={handleAnimationEnd}>
    <AlertDialog.Header>
      <AlertDialog.Title>{state.title}</AlertDialog.Title>
      <AlertDialog.Description>{state.description}</AlertDialog.Description>
    </AlertDialog.Header>

    {#if state.actionError}
      <Item.Root variant="danger">
        <Item.Media variant="icon">
          <WarningCircleIcon />
        </Item.Media>
        <Item.Content>{state.actionError}</Item.Content>
        <Item.Actions>
          <Button
            variant="ghost-destructive"
            size="icon-sm"
            class="hover:bg-danger-muted-hover"
            aria-label="Dismiss error"
            onclick={() => confirmationStore.setActionError(null)}
          >
            <XIcon />
          </Button>
        </Item.Actions>
      </Item.Root>
    {/if}

    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={state.actionPending}>
        {state.cancelLabel}
      </AlertDialog.Cancel>
      {#if state.action}
        <Button
          variant={state.action.variant}
          disabled={state.actionPending}
          onclick={(event) => {
            event.preventDefault()
            handleAction()
          }}
        >
          {actionLabel}
        </Button>
      {/if}
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
