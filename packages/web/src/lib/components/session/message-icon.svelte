<script lang="ts">
  import type { Component } from 'svelte'
  import type { MessageIconName } from '@sorato/core/presentation'
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon'
  import FileMagnifyingGlassIcon from 'phosphor-svelte/lib/FileMagnifyingGlassIcon'
  import FilePlusIcon from 'phosphor-svelte/lib/FilePlusIcon'
  import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon'
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon'
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon'
  import TerminalIcon from 'phosphor-svelte/lib/TerminalIcon'
  import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon'

  let {
    name,
    class: className = 'size-4 shrink-0 text-muted-foreground',
  }: {
    name?: MessageIconName | undefined
    class?: string | undefined
  } = $props()

  const icons = {
    tool: WrenchIcon,
    'tool-result': CheckCircleIcon,
    'file-text': FileTextIcon,
    'file-plus': FilePlusIcon,
    search: MagnifyingGlassIcon,
    'file-search': FileMagnifyingGlassIcon,
    edit: PencilSimpleIcon,
    terminal: TerminalIcon,
  } satisfies Record<MessageIconName, Component>

</script>

{#if name}
  {@const Icon = icons[name]}
  <Icon class={className} aria-hidden="true" />
{/if}
