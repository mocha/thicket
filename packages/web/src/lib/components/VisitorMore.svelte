<script lang="ts">
  /**
   * The end of a list when the API stopped it short: for a visitor without an
   * account, at the instance's newest items; for an account, at what its plan
   * shows. The API enforces the limit; this only says so and offers the way
   * past it.
   */
  import { page } from '$app/state';

  let { cap, reason = 'visitor', perFeed = null }: { cap: number; reason?: 'visitor' | 'plan'; perFeed?: number | null } = $props();
  const next = $derived(encodeURIComponent(page.url.pathname + page.url.search));
</script>

{#if reason === 'plan'}
  <p class="more"><strong>There’s more here.</strong> Your plan shows the {cap} most recent posts{#if perFeed && perFeed < cap} and the {perFeed} newest from each feed{/if}. <a href="/settings#plan">See your plan</a> for the way past this.</p>
{:else}
  <p class="more"><strong>But wait, there’s more!</strong> We only display the {cap} most recent items to visitors without an account. <a href="/login?next={next}">Log in</a> or <a href="/signup?next={next}">Create an account</a> to keep browsing.</p>
{/if}

<style>
  .more { margin: 4px 0 0; padding: 14px 16px; border-radius: 12px; background: var(--surface-2); color: var(--text-2); font-size: calc(14px * var(--size-app)); text-align: center; }
  .more strong { color: var(--text); }
  .more a { color: var(--accent); font-weight: 600; }
</style>
