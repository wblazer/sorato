<script lang="ts">
  import { cn } from '$lib/utils.js'

  let {
    label = 'Streaming',
    class: className,
    dotClass,
  }: {
    label?: string
    class?: string
    dotClass?: string
  } = $props()
</script>

<span class={cn('inline-flex shrink-0 items-center gap-1', className)}>
  <span class="sr-only">{label}</span>
  <span class={cn('streaming-dot', dotClass)} aria-hidden="true"></span>
  <span class={cn('streaming-dot', dotClass)} aria-hidden="true"></span>
  <span class={cn('streaming-dot', dotClass)} aria-hidden="true"></span>
</span>

<style>
  .streaming-dot {
    display: inline-block;
    width: 0.25rem;
    height: 0.25rem;
    border-radius: 9999px;
    background: currentColor;
    animation: streaming-dot-pulse 1.2s ease-in-out infinite;
  }

  .streaming-dot:nth-of-type(3) {
    animation-delay: 150ms;
  }

  .streaming-dot:nth-of-type(4) {
    animation-delay: 300ms;
  }

  @keyframes streaming-dot-pulse {
    0%,
    80%,
    100% {
      opacity: 0.35;
      transform: scale(0.85);
    }

    40% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
