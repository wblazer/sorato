<script lang="ts">
  let { message = 'Loading Sorato…' }: { message?: string } = $props()
</script>

<main class="flex h-screen items-center justify-center px-6 py-10">
  <div class="flex flex-col items-center gap-3 text-center">
    <div
      class="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
      aria-hidden="true"
    ></div>
    <p class="text-sm text-muted-foreground">{message}</p>
  </div>
</main>
