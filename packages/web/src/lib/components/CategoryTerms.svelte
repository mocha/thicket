<script lang="ts">
  /**
   * A feed's or a post's category terms, as the feed sent them (normalized),
   * for admins looking at what feeds provide (issue #189). Plain words in a
   * wrapping row, each with the number of posts that used it when there is
   * one. Not a control: nothing here is pressed.
   */
  interface Props {
    terms: { term: string; posts?: number }[];
    /** What to say when there are none. */
    empty?: string;
  }
  let { terms, empty = 'None sent.' }: Props = $props();
</script>

{#if terms.length}
  <ul class="terms">
    {#each terms as t (t.term)}
      <li>{t.term}{#if t.posts !== undefined}<span class="n">{t.posts}</span>{/if}</li>
    {/each}
  </ul>
{:else}
  <p class="none">{empty}</p>
{/if}

<style>
  .terms { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .terms li { display: inline-flex; align-items: baseline; gap: var(--space-1); padding: 2px var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--surface-2); color: var(--text); overflow-wrap: anywhere; }
  .n { color: var(--text-2); font-variant-numeric: tabular-nums; }
  .none { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
</style>
