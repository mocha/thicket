<script lang="ts">
  import { highlight } from '$lib/words';

  /**
   * Text a search matched, with the matched words highlighted. The words come
   * fenced from the server (see lib/words.ts) and are drawn here as plain text,
   * so a post's own markup never reaches the page. One highlight on every card.
   */
  let { text }: { text: string } = $props();
</script>

{#each highlight(text) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}

<style>
  mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: var(--radius-xs); padding: 0 1px; }
</style>
