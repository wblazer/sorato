<script lang="ts">
	let {
		onSend,
		disabled = false,
		placeholder = 'Type a message...',
	}: {
		onSend: (input: string) => void;
		disabled?: boolean;
		placeholder?: string;
	} = $props();

	let input = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	function handleSubmit() {
		const trimmed = input.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		input = '';
		// Reset textarea height
		if (textarea) {
			textarea.style.height = 'auto';
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	// Auto-resize textarea
	function handleInput() {
		if (textarea) {
			textarea.style.height = 'auto';
			textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
		}
	}
</script>

<div class="border-t border-border bg-background p-4">
	<div
		class="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 ring-ring focus-within:ring-1"
	>
		<textarea
			bind:this={textarea}
			bind:value={input}
			onkeydown={handleKeydown}
			oninput={handleInput}
			{placeholder}
			{disabled}
			rows={1}
			class="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
		></textarea>
		<button
			onclick={handleSubmit}
			disabled={disabled || !input.trim()}
			class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="m5 12 7-7 7 7" />
				<path d="M12 19V5" />
			</svg>
		</button>
	</div>
</div>
