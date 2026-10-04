<script lang="ts">
  /**
   * The end of a list for someone signed in, once there is nothing older to
   * load: a nudge toward Explore for something new to follow. Nothing is mixed
   * into the list itself; this only says where more is. The visitor's version,
   * with its sign-up offer, is VisitorMore, and looks the same.
   */
  import { api } from '$lib/api';

  let { hidden = 0, from }: {
    /** Posts left out by the reader's blocks, said here so the count isn't lost. */
    hidden?: number;
    /** Which list this ends, for the event: everything, collection or feed. */
    from: string;
  } = $props();
</script>

<p class="more"><strong>That’s everything.</strong>{#if hidden} {hidden} hidden by your blocks.{/if} Want more to read? <a href="/explore" onclick={() => api.event('explore_from_end', { from })}>Find something new to follow</a> in Explore.</p>

<style>
  /* The same box as VisitorMore, so the two ends of a list read as one thing. */
  .more { margin: var(--space-1) 0 0; padding: var(--space-4); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; }
  .more strong { color: var(--text); }
  .more a { color: var(--accent); font-weight: 600; }
</style>
