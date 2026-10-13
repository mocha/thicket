<script lang="ts">
  /**
   * Every feed in the index, for its admins (issue #103): a dense table, a
   * page of a couple hundred at a time, to search for a feed, see which are
   * failing and how many people that affects, and click through to change one.
   * The search, filter, order and page all live in the address, so Back and a
   * shared link both land on the same list.
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, adminApi, ADMIN_FEED_FILTERS, ADMIN_FEED_SORTS, type AdminFeed, type AdminFeedFilter, type AdminFeedPage, type AdminFeedSort } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { hostOf, relativeTime } from '$lib/time';
  import { plural } from '$lib/words';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import BackLink from '$lib/components/BackLink.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import Select from '$lib/components/Select.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';

  const PER = ['100', '200', '500'];
  const one = <T extends string>(list: readonly T[], v: string | null): T | undefined => (list as readonly string[]).includes(v ?? '') ? (v as T) : undefined;

  const params = $derived(page.url.searchParams);
  const q = $derived(params.get('q') ?? '');
  const filter = $derived(one(ADMIN_FEED_FILTERS, params.get('filter')) ?? 'all');
  const sort = $derived(one(ADMIN_FEED_SORTS, params.get('sort')) ?? 'followers');
  const dir = $derived(one(['asc', 'desc'] as const, params.get('dir')));
  const pageNo = $derived(Math.max(1, Math.trunc(Number(params.get('page'))) || 1));
  const per = $derived(one(PER, params.get('per')) ?? '200');

  let data = $state<AdminFeedPage | null>(null);
  let loading = $state(false);
  let failed = $state<string | null>(null);
  let draft = $state('');
  let ready = $state(false);

  /** Change the list by changing the address; anything back at its default is left out of it. Anything but turning the page starts again at page one. */
  function go(next: { q?: string; filter?: AdminFeedFilter; sort?: AdminFeedSort; dir?: 'asc' | 'desc' | undefined; page?: number; per?: string }) {
    const merged = { q, filter, sort, dir, per, ...next, page: next.page ?? 1 };
    const out = new URLSearchParams();
    if (merged.q.trim()) out.set('q', merged.q.trim());
    if (merged.filter !== 'all') out.set('filter', merged.filter);
    if (merged.sort !== 'followers') out.set('sort', merged.sort);
    if (merged.dir) out.set('dir', merged.dir);
    if (merged.page > 1) out.set('page', String(merged.page));
    if (merged.per !== '200') out.set('per', merged.per);
    const s = out.toString();
    void goto(`/admin/feeds${s ? `?${s}` : ''}`, { keepFocus: true, noScroll: next.page === undefined });
  }

  let latest = 0;
  async function load() {
    const ticket = ++latest;
    loading = true;
    failed = null;
    try {
      const r = await adminApi.feeds({ q, filter, sort, dir, page: pageNo, per: Number(per) });
      if (ticket === latest) data = r;
    } catch (e) {
      if (ticket === latest) failed = e instanceof Error ? e.message : String(e);
    } finally {
      if (ticket === latest) loading = false;
    }
  }

  onMount(() => {
    if (!session.user?.isAdmin) return void goto('/new-posts', { replaceState: true });
    api.event('admin_feeds_view');
    ready = true;
  });
  // Whenever the address changes, the list follows it, and the box shows what was searched.
  $effect(() => {
    if (!ready) return;
    void [q, filter, sort, dir, pageNo, per];
    draft = q;
    void load();
  });

  const FILTER_LABEL: Record<AdminFeedFilter, string> = { all: 'All', failing: 'Failing', broken: 'Broken', unfollowed: 'No followers', unfetched: 'Never fetched' };
  const tabs = $derived(ADMIN_FEED_FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], count: data?.counts[f] })));

  /** The columns, each with the order it sorts by. Pressing the column already sorted by turns it around. */
  const COLUMNS: { sort: AdminFeedSort; label: string; num?: boolean }[] = [
    { sort: 'title', label: 'Feed' },
    { sort: 'followers', label: 'Followers', num: true },
    { sort: 'posts', label: 'Posts', num: true },
    { sort: 'added', label: 'Added' },
    { sort: 'lastPost', label: 'Last post' },
    { sort: 'checked', label: 'Checked' },
    { sort: 'failures', label: 'Health' },
  ];
  const shownDir = $derived(data?.dir ?? (sort === 'title' ? 'asc' : 'desc'));
  function sortBy(col: AdminFeedSort) {
    if (col === sort) go({ sort: col, dir: shownDir === 'asc' ? 'desc' : 'asc' });
    else go({ sort: col, dir: undefined });
  }

  const pages = $derived(data ? Math.max(1, Math.ceil(data.total / data.per)) : 1);
  const range = $derived(data && data.total ? `${((data.page - 1) * data.per + 1).toLocaleString()}–${Math.min(data.total, data.page * data.per).toLocaleString()} of ${data.total.toLocaleString()}` : '');

  const full = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const address = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const name = (f: AdminFeed) => f.title ?? hostOf(f.siteUrl ?? f.url);
</script>

<svelte:head><title>Feeds · Admin · thicket</title></svelte:head>

<PageHeader name="Feeds">
  {#snippet above()}<BackLink href="/admin" label="Admin" />{/snippet}
  {#snippet description()}Every feed on this instance{#if data}: {plural(data.counts.all, 'feed')}{q ? ` matching “${q}”` : ''}{/if}. Broken means {data?.brokenAfter ?? 5} or more failed checks in a row.{/snippet}
</PageHeader>

<form class="search" role="search" onsubmit={(e) => { e.preventDefault(); go({ q: draft }); }}>
  <Field label="Search feeds" hideLabel>
    {#snippet children({ id })}
      <Input {id} variant="search" size="lg" enterkeyhint="search" bind:value={draft} onclear={() => go({ q: '' })} placeholder="Title, feed address, or site" autocomplete="off" autocapitalize="none" spellcheck={false}>
        {#snippet trailing()}<Button type="submit" variant="primary" disabled={!draft.trim() && !q}>Search</Button>{/snippet}
      </Input>
    {/snippet}
  </Field>
</form>

<Tabs tabs={tabs} value={filter} onchange={(v) => go({ filter: v as AdminFeedFilter })} label="Which feeds" panel="admin-feeds" />

<div class="bar">
  <span class="range" role="status">{#if loading}Loading…{:else if data}{data.total ? range : 'No feeds here.'}{/if}</span>
  <Select label="Per page" size="sm" value={per} options={PER.map((p) => ({ value: p, label: `${p} per page` }))} hideLabel onchange={(e) => go({ per: e.currentTarget.value })} />
</div>

{#if failed}
  <p class="status">Couldn’t load the feeds: {failed}</p>
{:else if data}
  <div class="scroll" id="admin-feeds" role="tabpanel" class:stale={loading}>
    <table>
      <thead>
        <tr>
          {#each COLUMNS as c (c.sort)}
            <th scope="col" class:num={c.num} aria-sort={c.sort === sort ? (shownDir === 'asc' ? 'ascending' : 'descending') : undefined}>
              <button type="button" class="sort tap" class:on={c.sort === sort} onclick={() => sortBy(c.sort)}>
                {c.label}{#if c.sort === sort}<span aria-hidden="true">{shownDir === 'asc' ? ' ↑' : ' ↓'}</span>{/if}
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
                {#if f.requiresSubscription}<Badge>Paywall</Badge>{/if}
              </div>
            </td>
            <td class="num">{f.followerCount.toLocaleString()}</td>
            <td class="num">{f.itemCount.toLocaleString()}<small>{f.posts30d.toLocaleString()} in 30d</small></td>
            <td title={full(f.createdAt)}>{relativeTime(f.createdAt)}</td>
            <td title={f.lastItemAt ? full(f.lastItemAt) : undefined}>{f.lastItemAt ? relativeTime(f.lastItemAt) : '—'}</td>
            <td title={f.lastFetchedAt ? full(f.lastFetchedAt) : undefined}>{f.lastFetchedAt ? relativeTime(f.lastFetchedAt) : 'never'}</td>
            <td class="health">
              {#if f.consecutiveFailures > 0}
                <span class="bad" title={f.lastError ?? undefined}>{f.consecutiveFailures} in a row<small>{f.lastError ?? (f.lastStatus ? `HTTP ${f.lastStatus}` : 'failed')}</small></span>
              {:else if f.lastFetchedAt}
                <span class="ok">OK</span>
              {:else}
                <span class="quiet">Not yet</span>
              {/if}
              {#if f.checks > 0}<small>{f.failures} of {f.checks} failed, {data.windowDays}d</small>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if pages > 1}
    <nav class="pager" aria-label="Pages">
      <Button size="sm" disabled={data.page <= 1 || loading} onclick={() => go({ page: data!.page - 1 })}>Previous</Button>
      <span>Page {data.page.toLocaleString()} of {pages.toLocaleString()}</span>
      <Button size="sm" disabled={data.page >= pages || loading} onclick={() => go({ page: data!.page + 1 })}>Next</Button>
    </nav>
  {/if}
{:else}
  <p class="status">Loading…</p>
{/if}

<style>
  .search { margin-bottom: var(--space-3); }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: var(--space-3) 0; }
  .range { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  /* Wider than a phone: the table slides sideways inside its own box rather than squeezing. */
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
  .scroll.stale { opacity: 0.6; }
  table { width: 100%; min-width: 860px; border-collapse: collapse; font-size: calc(var(--text-sm) * var(--size-app)); }
  th, td { padding: var(--space-2) var(--space-3); text-align: left; vertical-align: top; border-top: 1px solid var(--line); white-space: nowrap; }
  thead th { border-top: 0; background: var(--surface-2); position: sticky; top: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .sort { font: inherit; font-weight: 600; color: var(--text-2); background: none; border: 0; padding: 0; cursor: pointer; }
  .sort.on { color: var(--text); }
  /* The feed column takes whatever the numbers leave, and its address is cut short rather than widening the table. */
  td.feed { white-space: normal; min-width: 280px; max-width: 420px; }
  .cell { display: flex; align-items: flex-start; gap: var(--space-2); }
  .who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .title { font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
  .url { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td small { display: block; color: var(--text-2); font-size: calc(var(--text-xs) * var(--size-app)); }
  .health { min-width: 160px; white-space: normal; }
  .bad { color: var(--danger); font-weight: 600; }
  .bad small { font-weight: 400; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ok { color: var(--text-2); }
  .quiet { color: var(--text-2); font-style: italic; }
  .pager { display: flex; align-items: center; justify-content: center; gap: var(--space-3); margin: var(--space-4) 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .status { text-align: center; color: var(--text-2); padding: var(--space-6) 0; }
</style>
