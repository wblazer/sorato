<script lang="ts">
	let { text, isStreaming }: { text: string; isStreaming: boolean } = $props();
</script>

{#if isStreaming}
	<div class="flex flex-col gap-2 border-l-2 border-l-blue-500/30 py-2 pl-4">
		<div class="flex items-center gap-2">
			<span class="text-[10px] font-bold uppercase tracking-widest text-blue-400">
				assistant
			</span>
			<span class="flex items-center gap-1">
				<span class="inline-block h-1 w-1 animate-pulse rounded-full bg-blue-400"></span>
				<span class="text-[10px] text-muted-foreground">streaming</span>
			</span>
		</div>
		{#if text}
			<div class="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
				{text}<span class="inline-block h-4 w-0.5 animate-pulse bg-blue-400"></span>
			</div>
		{:else}
			<div class="flex items-center gap-1.5">
				<span class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40"></span>
				<span class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40" style="animation-delay: 150ms"></span>
				<span class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40" style="animation-delay: 300ms"></span>
			</div>
		{/if}
	</div>
{/if}
