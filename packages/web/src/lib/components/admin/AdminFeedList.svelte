<script lang="ts">
  /**
   * Every feed in the index, for its admins (issue #103): a table, a page of
   * a couple hundred at a time, to search for a feed, see which are failing
   * and how many people that affects, and click through to change one. No
   * filters: sorting by Health puts the broken feeds first, most-followed first.
   * The search and order live in the address, so Back and a shared
   * link both land on the same list.
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, adminApi, ADMIN_FEED_SORTS, type AdminFeed, type AdminFeedPage, type AdminFeedSort } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';
  import EmptyNote from '$lib/components/EmptyNote.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import { healthWord } from '$lib/feedhealth';

  let { oncounts }: { oncounts?: (counts: AdminFeedPage['counts']) => void } = $props();

  const one = <T extends string>(list: readonly T[], v: string | null): T | undefined => (list as readonly string[]).includes(v ?? '') ? (v as T) : undefined;

  const params = $derived(page.url.searchParams);
  const q = $derived(params.get('q') ?? '');
  const sort = $derived(one(ADMIN_FEED_SORTS, params.get('sort')) ?? 'followers');
  const dir = $derived(one(['asc', 'desc'] as const, params.get('dir')));

  let data = $state<AdminFeedPage | null>(null);
  let loading = $state(false);
  let failed = $state<string | null>(null);
  let draft = $state('');
  let ready = $state(false);

  /** Change the list by changing the address; anything back at its default is left out of it. Anything but turning the page starts again at page one. */
  function go(next: { q?: string; sort?: AdminFeedSort; dir?: 'asc' | 'desc' | undefined }) {
    const merged = { q, sort, dir, ...next };
    const out = new URLSearchParams({ tab: 'feeds' });
    if (merged.q.trim()) out.set('q', merged.q.trim());
    if (merged.sort !== 'followers') out.set('sort', merged.sort);
    if (merged.dir) out.set('dir', merged.dir);
    const s = out.toString();
    void goto(`/admin?${s}`, { keepFocus: true, noScroll: true });
  }

  let latest = 0;
  async function load() {
    const ticket = ++latest;
    loading = true;
    failed = null;
    try {
      const r = await adminApi.feeds({ q, sort, dir, page: 1 });
      if (ticket === latest) { data = r; if (!q) oncounts?.(r.counts); }
    } catch (e) {
      if (ticket === latest) failed = e instanceof Error ? e.message : String(e);
    } finally {
      if (ticket === latest) loading = false;
    }
  }

  /* Show more, as on Accounts: the next page joins the end of the list. Anything still on its way is dropped when the search or order changes. */
  let more = $state(false);
  async function showMore() {
    if (!data || more || loading) return;
    const ticket = latest;
    more = true;
    try {
      const r = await adminApi.feeds({ q, sort, dir, page: data.page + 1 });
      if (ticket === latest && data) data = { ...r, feeds: [...data.feeds, ...r.feeds] };
    } catch (e) {
      if (ticket === latest) failed = e instanceof Error ? e.message : String(e);
    } finally {
      more = false;
    }
  }

  onMount(() => {
    api.event('admin_feeds_view');
    ready = true;
  });
  // Whenever the address changes, the list follows it, and the box shows what was searched.
  $effect(() => {
    if (!ready) return;
    void [q, sort, dir];
    draft = q;
    void load();
  });


  /** The columns, each with the order it sorts by. Pressing the column already sorted by turns it around. */
  const COLUMNS: { sort: AdminFeedSort; label: string; num?: boolean }[] = [
    { sort: 'title', label: 'Feed' },
    { sort: 'followers', label: 'Followers', num: true },
    { sort: 'posts', label: 'Posts (30d)', num: true },
    { sort: 'lastPost', label: 'Last post' },
    { sort: 'failures', label: 'Health' },
  ];

  const shownDir = $derived(data?.dir ?? (sort === 'title' ? 'asc' : 'desc'));
  function sortBy(col: AdminFeedSort) {
    if (col === sort) go({ sort: col, dir: shownDir === 'asc' ? 'desc' : 'asc' });
    else go({ sort: col, dir: undefined });
  }

  const hasMore = $derived(!!data && data.feeds.length < data.total);
  /** "Show 200 more": how many the next press adds. The total is already on the Feeds tab. */
  const moreLabel = $derived(data ? `Show ${Math.min(data.per, data.total - data.feeds.length).toLocaleString()} more` : 'Show more');

  const full = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const address = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const name = (f: AdminFeed) => f.title ?? hostOf(f.siteUrl ?? f.url);

  const health = (f: AdminFeed) => healthWord(f, data?.brokenAfter);
</script>

<form class="search" role="search" onsubmit={(e) => { e.preventDefault(); go({ q: draft }); }}>
  <Field label="Search feeds" hideLabel>
    {#snippet children({ id })}
      <Input {id} variant="search" size="lg" enterkeyhint="search" bind:value={draft} onclear={() => go({ q: '' })} placeholder="Title, feed address, or site" autocomplete="off" autocapitalize="none" spellcheck={false}>
        {#snippet trailing()}<Button type="submit" variant="primary" disabled={!draft.trim() && !q}>Search</Button>{/snippet}
      </Input>
    {/snippet}
  </Field>
</form>


{#if failed}
  <p class="status">Couldn’t load the feeds: {failed}</p>
{:else if data && !data.total && q}
  <EmptyNote icon="search" title="No feeds match “{q}”" text="Try part of its title, its address, or its site." />
{:else if data}
  <div class="scroll" class:stale={loading}>
    <table>
      <thead>
        <tr>
          {#each COLUMNS as c (c.sort)}
            <th scope="col" class:num={c.num} class:fit={c.sort !== 'title' && c.sort !== 'failures'} class:oneline={c.sort === 'posts'} aria-sort={c.sort === sort ? (shownDir === 'asc' ? 'ascending' : 'descending') : undefined}>
              <button type="button" class="sort tap" class:on={c.sort === sort} onclick={() => sortBy(c.sort)}>
                {c.label}{#if c.sort === sort}<span aria-hidden="true">{shownDir === 'asc' ? '\u00a0↑' : '\u00a0↓'}</span>{/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each data.feeds as f (f.id)}
          <tr class:failing={f.consecutiveFailures > 0}>
            <td class="feed">
              <div class="cell">
                <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={name(f)} size={20} />
                <div class="who">
                  <a class="title tap" href="/feeds/{f.id}/settings?admin">{name(f)}</a>
                  <span class="url" title={f.url}>{address(f.url)}</span>
                </div>
              </div>
            </td>
            <td class="num fit">{f.followerCount.toLocaleString()}</td>
            <td class="num fit">{f.posts30d.toLocaleString()}</td>
            <td class="fit" title={f.lastItemAt ? full(f.lastItemAt) : undefined}>{f.lastItemAt ? relativeTime(f.lastItemAt) : '—'}</td>
            <td class="health">
              {#if f.consecutiveFailures > 0}
                <Button variant="danger" link size="sm" href="/feeds/{f.id}/settings?admin">{health(f)}</Button>
              {:else}
                <span class:quiet={!f.lastFetchedAt}>{health(f)}</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if hasMore}<button class="row-more tap" onclick={showMore} disabled={more || loading}>{more ? 'Loading…' : moreLabel}</button>{/if}
  </div>

{:else}
  <p class="status">Loading…</p>
{/if}

<style>
  .search { margin-bottom: var(--space-3); }
  /* Fits the page's own column; on a phone the table slides sideways inside its own box rather than squeezing. */
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
  .scroll.stale { opacity: 0.6; }
  table { width: 100%; border-collapse: collapse; font-size: calc(var(--text-sm) * var(--size-app)); }
  th, td { padding: var(--space-2); text-align: left; vertical-align: top; border-top: 1px solid var(--line); white-space: nowrap; }
  /* A heading may wrap ("Posts / (30d)"), so the short values under it, not its words, set how wide the column is. */
  thead th { white-space: normal; }
  /* Followers, posts, and last post shrink to what they hold, and the room goes to the feed's name. */
  .fit { width: 1%; }
  /* Except "Posts (30d)", kept whole: the 30 days is what the number means. */
  thead th.oneline { white-space: nowrap; }
  thead th { border-top: 0; background: var(--surface-2); position: sticky; top: 0; }
  /* Numbers line up with the words: every column starts at its left edge, with even-width digits. */
  .num { font-variant-numeric: tabular-nums; }
  .sort { font: inherit; font-weight: 600; color: var(--text-2); background: none; border: 0; padding: 0; cursor: pointer; }
  .sort.on { color: var(--text); }
  /* The feed column takes whatever the numbers leave (the zero cap lets it shrink to that), and its address is cut short rather than widening the table. */
  td.feed { white-space: normal; width: 100%; max-width: 0; }
  .cell { display: flex; align-items: flex-start; gap: var(--space-2); }
  .who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .title { font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
  .url { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .health { color: var(--text-2); }
  .quiet { color: var(--text-2); font-style: italic; }
  .status { text-align: center; color: var(--text-2); padding: var(--space-6) 0; }
</style>
