<script lang="ts">
  /**
   * Add a feed, in a sheet you can flick away. Top to bottom, in the order you
   * decide things: the address, which of your collections it goes in, then
   * Follow. Opened from a collection, that one is ticked; opened from
   * Everything, none is — and if you leave it that way, Follow drops the feed
   * in your default collection. Success lands on the feed's own page. Nothing
   * is saved until Follow, so closing is a true cancel.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, feedHref, type SubscribeOutcome } from '$lib/api';
  import { addFeed, closeAddFeed } from '$lib/addfeed.svelte';
  import { loadCollections, whereItGoes } from '$lib/collections.svelte';
  import { hostOf } from '$lib/time';
  import { showToast } from '$lib/toast.svelte';
  import Sheet from './Sheet.svelte';
  import CollectionList from './CollectionList.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let url = $state('');
  let ids = $state<number[]>([]);
  let busy = $state(false);
  let outcome = $state<SubscribeOutcome | null>(null);
  /** Set while we leave for the feed page, so closing the sheet doesn't also send /add home. */
  let landing = false;

  /* Both ways this can go wrong are about the address, so they belong under
     the address box. "More than one feed here" isn't a failure and stays a
     list further down. */
  const urlError = $derived(
    outcome && 'error' in outcome
      ? `Couldn’t reach that: ${outcome.error}`
      : outcome?.status === 'none'
        ? `No feed found at ${hostOf(outcome.pageUrl)}. Try the site’s blog or news section.`
        : null
  );

  // Each open() resets the form from the options it was opened with.
  $effect(() => {
    void addFeed.nonce;
    const o = addFeed.opts;
    url = o.url ?? '';
    ids = [...(o.collectionIds ?? [])];
    outcome = null; busy = false; landing = false;
    // Opened from a collection, that one starts ticked. Opened from Everything,
    // nothing is ticked — leave it and Follow drops the feed in your default
    // collection, which the hint below spells out.
    // (The list centers that ticked row itself, since it is often below the fold.)
    void loadCollections().then((s) => { ids = ids.filter((id) => id !== s.rootId); });
    dialog?.showModal();
    if (o.autoSubmit && url) void submit(url);
    else queueMicrotask(() => input?.focus());
  });

  function toggle(id: number) {
    ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  const hint = $derived(whereItGoes(ids));

  /** Any URL in. A page, a feed, a shared link from another app: the server figures it out. */
  async function submit(target = url) {
    const value = target.trim();
    if (!value || busy) return;
    busy = true; outcome = null;
    try {
      const res = await api.addFeed(value, ids);
      outcome = res;
      if ('status' in res && res.status === 'subscribed') {
        api.event('feed_added', { feedId: res.feed.id, alreadyFollowed: res.alreadyFollowed, collectionIds: ids, via: addFeed.opts.via ?? 'sheet' });
        showToast(res.alreadyFollowed ? `Already following ${res.feed.title ?? hostOf(res.feed.url)}` : `Following ${res.feed.title ?? hostOf(res.feed.url)}`);
        void loadCollections(true);
        landing = true;
        dialog?.close();
        await goto(feedHref(res.feed));
      }
    } catch (e) {
      outcome = { error: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }

  /** Closing from /add (the share target) has nothing underneath; go home. */
  function onclose() {
    closeAddFeed();
    if (!landing && page.url.pathname === '/add') void goto('/', { replaceState: true });
  }
</script>

<Sheet title="Add a feed" bind:dialog {onclose}>
  <form id="add-feed" class="form" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <p class="lede">Enter the address of a site, blog, subreddit, or YouTube channel or video, and thicket finds the feed for you. You can also enter the feed itself.</p>
    <Field label="Address" hideLabel error={urlError}>
      {#snippet children({ id, describedBy, invalid })}
        <Input
          {id}
          aria-describedby={describedBy}
          {invalid}
          bind:element={input}
          bind:value={url}
          inset
          type="url"
          inputmode="url"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          placeholder="example.com"
          required
          disabled={busy}
        />
      {/snippet}
    </Field>

    {#if outcome && !('error' in outcome) && outcome.status === 'choose'}
      <div class="result">
        <p>There’s more than one way to follow this. Which one?</p>
        <ul class="candidates">
          {#each outcome.candidates as c}
            <li><button type="button" onclick={() => submit(c.url)} disabled={busy}><strong>{c.title ?? hostOf(c.url)}</strong><span>{c.note ?? c.url}</span></button></li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="eyebrow">Put it in a collection</div>
    {#key addFeed.nonce}
      <CollectionList {ids} {hint} via="add_sheet" disabled={busy} ontoggle={toggle} oncreated={(id) => (ids = [...ids, id])} />
    {/key}
  </form>
  {#snippet footer()}
    <button type="submit" form="add-feed" class="sheet-action" disabled={busy || !url.trim()}>{busy ? 'Looking…' : 'Follow'}</button>
  {/snippet}
</Sheet>

<style>
  /* The form is only here to make Enter submit; its children lay out as the Sheet's own. */
  .form { display: contents; }
  /* Pulled up against the title so the two read as one block. */
  .lede { color: var(--text-2); margin: calc(-1 * var(--space-2)) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .result { margin: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .result p { margin: 0 0 var(--space-2); }
  .candidates { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .candidates button { width: 100%; text-align: left; display: flex; flex-direction: column; /* 2px is an optical gap between a name and its address. */ gap: 2px; padding: var(--space-3); border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--line); }
  .candidates span { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); overflow-wrap: anywhere; }
  .eyebrow { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-top: var(--space-1); }
</style>
