<script lang="ts">
  /**
   * The end of a list for a visitor without an account, when the instance holds
   * visitors to its newest items and there were more. The API enforces the
   * limit; this only says so and offers the way past it.
   *
   * At the end of someone's collection, signing up or logging in from here
   * also copies that collection, the same as its Copy button. Anywhere else
   * (a profile's activity, bookmarks) it just brings you back.
   */
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { copyNext } from '$lib/copyintent.svelte';

  let { cap }: { cap: number } = $props();
  const onCollection = $derived(page.route.id === '/@[handle]/collections/[slug]');
  const handle = $derived(page.params.handle ?? '');
  const slug = $derived(page.params.slug ?? '');
  const next = $derived(encodeURIComponent(onCollection ? copyNext(handle, slug, 'visitor_more') : page.url.pathname + page.url.search));
  function started() {
    if (onCollection) api.event('copy_signup_started', { handle, slug, from: 'visitor_more' });
  }
</script>

<p class="more"><strong>But wait, there’s more!</strong> We only display the {cap} most recent items to visitors without an account. <a href="/login?next={next}" onclick={started}>Log in</a> or <a href="/signup?next={next}" onclick={started}>sign up</a> to keep browsing.</p>

<style>
  .more { margin: var(--space-1) 0 0; padding: var(--space-4); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; }
  .more strong { color: var(--text); }
  .more a { color: var(--accent); font-weight: 600; }
</style>
