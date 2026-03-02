<script lang="ts">
	import type { MessagePart } from '$lib/types.js';

	let { part }: { part: MessagePart } = $props();
</script>

{#if part.type === 'text'}
	<div class="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
		{part.text}
	</div>
{:else if part.type === 'reasoning'}
	<details class="group">
		<summary
			class="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground"
		>
			<span class="inline-flex items-center gap-1.5">
				<span
					class="inline-block h-1.5 w-1.5 rounded-full bg-violet-500/60"
				></span>
				reasoning
			</span>
		</summary>
		<div
			class="mt-2 whitespace-pre-wrap break-words border-l-2 border-violet-500/20 pl-3 font-mono text-sm text-muted-foreground"
		>
			{part.text}
		</div>
	</details>
{:else if part.type === 'tool-call'}
	<div class="flex flex-col gap-1.5">
		<div class="flex items-center gap-2">
			<span
				class="inline-block h-1.5 w-1.5 rounded-full bg-blue-500/60"
			></span>
			<span class="text-xs font-medium text-blue-400"
				>tool-call</span
			>
			<code
				class="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground"
				>{part.name}</code
			>
			{#if part.id}
				<span class="text-xs text-muted-foreground">{part.id.slice(0, 8)}</span
				>
			{/if}
		</div>
		{#if part.params != null}
			<pre
				class="max-h-48 overflow-auto rounded bg-muted/50 p-2 text-xs leading-relaxed">{JSON.stringify(part.params, null, 2)}</pre>
		{/if}
	</div>
{:else if part.type === 'tool-result'}
	<div class="flex flex-col gap-1.5">
		<div class="flex items-center gap-2">
			<span
				class="inline-block h-1.5 w-1.5 rounded-full {part.isFailure ? 'bg-red-500/60' : 'bg-green-500/60'}"
			></span>
			<span
				class="text-xs font-medium {part.isFailure ? 'text-red-400' : 'text-green-400'}"
				>{part.isFailure ? 'tool-error' : 'tool-result'}</span
			>
			<code
				class="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground"
				>{part.name}</code
			>
		</div>
		{#if part.result != null}
			{@const resultStr =
				typeof part.result === 'string'
					? part.result
					: JSON.stringify(part.result, null, 2)}
			<pre
				class="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs leading-relaxed">{resultStr}</pre>
		{/if}
	</div>
{:else if part.type === 'file'}
	<div class="flex items-center gap-2">
		<span
			class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500/60"
		></span>
		<span class="text-xs font-medium text-amber-400">file</span>
		{#if part.fileName}
			<code class="text-xs text-muted-foreground">{part.fileName}</code>
		{/if}
		<span class="text-xs text-muted-foreground">{part.mediaType}</span>
	</div>
{/if}
