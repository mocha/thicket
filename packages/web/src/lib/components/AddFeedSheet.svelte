<script lang="ts">
  /**
   * Add a feed, in a sheet you can flick away. Top to bottom, in the order you
   * decide things: the address, which of your collections it goes in, then
   * Follow. Opened from a collection, that one is ticked; opened from
   * Everything, none is — and if you leave it that way, Follow drops the feed
   * in your default collection. Success lands on the feed's own page. Nothing
   * is saved until Follow, so closing is a true cancel.
   */
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, collectionsApi, feedHref, type SubscribeOutcome } from '$lib/api';
  import { addFeed, closeAddFeed } from '$lib/addfeed.svelte';
  import { collectionStore, defaultCollection, loadCollections, namedCollections } from '$lib/collections.svelte';
  import { hostOf } from '$lib/time';
  import { showToast } from '$lib/toast.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLElement | null>(null);
  let url = $state('');
  let ids = $state<number[]>([]);
  let newName = $state('');
  let creating = $state(false);
  let busy = $state(false);
  let outcome = $state<SubscribeOutcome | null>(null);
  /** Set while we leave for the feed page, so closing the sheet doesn't also send /add home. */
  let landing = false;

  // Each open() resets the form from the options it was opened with.
  $effect(() => {
    void addFeed.nonce;
    const o = addFeed.opts;
    url = o.url ?? '';
    ids = [...(o.collectionIds ?? [])];
    newName = ''; outcome = null; busy = false; landing = false;
    // Opened from a collection, that one starts ticked. Opened from Everything,
    // nothing is ticked — leave it and Follow drops the feed in your default
    // collection, which the hint below spells out.
    void loadCollections().then(async (s) => {
      ids = ids.filter((id) => id !== s.rootId);
      // The list scrolls and is alphabetical, so a ticked one is often below
      // the fold. Bring it up: where this is going should never be off screen.
      await tick();
      list?.querySelector('input:checked')?.closest('li')?.scrollIntoView({ block: 'nearest' });
    });
    dialog?.showModal();
    if (o.autoSubmit && url) void submit(url);
    else queueMicrotask(() => input?.focus());
  });

  function toggle(id: number) {
    ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  const nameOf = (id: number) => namedCollections().find((c) => c.id === id)?.name ?? 'a collection';

  async function createCollection() {
    const name = newName.trim();
    if (!name || creating) return;
    creating = true;
    try {
      const c = await collectionsApi.create(name);
      await loadCollections(true);
      newName = '';
      ids = [...ids, c.id];
      api.event('collection_created', { collectionId: c.id, via: 'add_sheet' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      creating = false;
    }
  }

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

<dialog bind:this={dialog} {onclose} onclick={(e) => { if (e.target === dialog) dialog?.close(); }}>
  <form class="sheet" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <header>
      <h2>Add a feed</h2>
      <button type="button" class="close" onclick={() => dialog?.close()} aria-label="Close">×</button>
    </header>
    <p class="lede">Enter the address of a site, blog, subreddit, or YouTube channel or video, and thicket finds the feed for you. You can also enter the feed itself.</p>
    <input bind:this={input} bind:value={url} type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="example.com" required disabled={busy} />

    {#if outcome && 'error' in outcome}
      <p class="result bad">Couldn’t reach that: {outcome.error}</p>
    {:else if outcome?.status === 'none'}
      <p class="result bad">No feed found at {hostOf(outcome.pageUrl)}. Try the site’s blog or news section.</p>
    {:else if outcome?.status === 'choose'}
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
    <div class="scroll" bind:this={list}>
    <ul class="checks">
      {#each namedCollections() as c (c.id)}
        <li>
          <label>
            <input type="checkbox" checked={ids.includes(c.id)} onchange={() => toggle(c.id)} disabled={busy} />
            <span class="name">{c.name}</span>
            <span class="count">{c.feedCount}</span>
          </label>
        </li>
      {/each}
    </ul>
    </div>
    <p class="hint">{#if !namedCollections().length}No collections yet — one will be made for this feed.{:else if ids.length === 1}It goes in {nameOf(ids[0])}. Tick more if it belongs in several.{:else if ids.length}It goes in {ids.length} of your collections.{:else}Pick one, or it goes in {defaultCollection()?.name ?? 'your first collection'}.{/if}</p>
    {#if collectionStore.loaded}
      <div class="new">
        <span class="plus" aria-hidden="true">+</span>
        <input type="text" placeholder="Start a new collection…" bind:value={newName} disabled={creating} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createCollection(); } }} />
        <button type="button" onclick={createCollection} disabled={creating || !newName.trim()}>Create</button>
      </div>
    {/if}

    <button type="submit" class="follow" disabled={busy || !url.trim()}>{busy ? 'Looking…' : 'Follow'}</button>
  </form>
</dialog>

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text);
    border-radius: 20px 20px 0 0; padding: 16px 16px calc(16px + var(--safe-b)); max-height: 90vh; overflow: hidden;
    box-shadow: 0 -10px 40px rgba(0,0,0,0.25); display: flex; flex-direction: column; gap: 10px;
  }
  @media (min-width: 700px) {
    .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 460px; border-radius: 20px; max-height: 86vh; }
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-size: calc(22px * var(--size-headings)); font-family: var(--font-headings); }
  .close { width: 32px; height: 32px; border-radius: 50%; font-size: calc(22px * var(--size-app)); color: var(--text-3); }
  .lede { color: var(--text-2); margin: -6px 0 0; font-size: calc(14px * var(--size-app)); }
  input[type='url'] { padding: 13px 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: calc(16px * var(--size-app)); width: 100%; }
  input[type='url']:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .result { margin: 0; color: var(--text-2); font-size: calc(14px * var(--size-app)); }
  .result p { margin: 0 0 6px; }
  .bad { color: var(--danger); }
  .candidates { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .candidates button { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--line); }
  .candidates span { font-size: calc(12px * var(--size-app)); color: var(--text-3); overflow-wrap: anywhere; }
  .eyebrow { font-size: calc(11px * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-top: 4px; }
  .scroll { overflow-y: auto; min-height: 0; flex: 1 1 auto; max-height: 38vh; border: 1px solid var(--line); border-radius: 12px; padding: 0 10px; }
  /* Desktop cap. Must come after the base .scroll rule above: same specificity,
     so source order decides, and the list should top out at ~7 rows and scroll,
     not grow to a third of a tall screen. */
  @media (min-width: 700px) { .scroll { max-height: 300px; } }
  .checks { list-style: none; margin: 0; padding: 0; }
  .checks label { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-top: 1px solid var(--line); cursor: pointer; }
  .checks li:first-child label { border-top: 0; }
  .checks input { width: 20px; height: 20px; accent-color: var(--accent); }
  .name { flex: 1; font-weight: 500; }
  .count { font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .hint { margin: -4px 0 0; font-size: calc(12px * var(--size-app)); color: var(--text-3); }
  .new { display: flex; align-items: center; gap: 8px; }
  .plus { width: 20px; text-align: center; color: var(--accent); font-size: calc(20px * var(--size-app)); line-height: 1; font-weight: 600; }
  .new input { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 10px; border: 1px dashed var(--accent); background: var(--surface); color: var(--text); font-size: calc(15px * var(--size-app)); }
  .new input::placeholder { color: var(--accent); opacity: 0.85; }
  .new input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-style: solid; }
  .new button { padding: 10px 14px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .new button:disabled { opacity: 0.35; }
  .follow { margin-top: 6px; padding: 14px; border-radius: 14px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(16px * var(--size-app)); }
  .follow:disabled { opacity: 0.5; }
</style>
