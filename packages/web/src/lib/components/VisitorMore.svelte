<script lang="ts">
  /**
   * The end of a list for a visitor without an account, when the instance holds
   * visitors to its newest items and there were more. The API enforces the
   * limit; this only says so and offers the way past it.
   */
  import { page } from '$app/state';

  let { cap }: { cap: number } = $props();
  const next = $derived(encodeURIComponent(page.url.pathname + page.url.search));
</script>

<p class="more"><strong>But wait, there’s more!</strong> We only display the {cap} most recent items to visitors without an account. <a href="/login?next={next}">Log in</a> or <a href="/signup?next={next}">Create an account</a> to keep browsing.</p>

<style>
  .more { margin: 4px 0 0; padding: 14px 16px; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; }
  .more strong { color: var(--text); }
  .more a { color: var(--accent); font-weight: 600; }
</style>
