<script lang="ts">
  let { label = 'Loading…' }: { label?: string } = $props()
</script>

<div class="flex h-full min-h-64 items-center justify-center p-8 text-center">
  <div class="flex items-center gap-2 text-sm text-muted-foreground">
    <div
      class="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
      aria-hidden="true"
    ></div>
    <span>{label}</span>
  </div>
</div>
