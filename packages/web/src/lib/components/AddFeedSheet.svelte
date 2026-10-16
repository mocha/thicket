<script lang="ts">
  /**
   * Add a feed, in a sheet you can flick away. Top to bottom, in the order you
   * decide things: the address, which of your collections it goes in, then
   * Follow. As you type, feeds already on this site whose name or address
   * matches are listed under the box; picking one fills in its address and
   * leaves Follow to you. Opened from a collection, that one is ticked; opened from
   * Everything, none is — and if you leave it that way, Follow drops the feed
   * in your default collection. Success lands on the feed's own page. Nothing
   * is saved until Follow, so closing is a true cancel.
   */
  import { tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError, feedHref, type Feed, type FeedSuggestion, type SubscribeOutcome } from '$lib/api';
  import { addFeed, closeAddFeed } from '$lib/addfeed.svelte';
  import { loadCollections, namedCollections, needsCollection, whereItGoes } from '$lib/collections.svelte';
  import { hostOf } from '$lib/time';
  import { showToast } from '$lib/toast.svelte';
  import Checkbox from './Checkbox.svelte';
  import Sheet from './Sheet.svelte';
  import Button from './Button.svelte';
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
  /** The address that turned up several feeds, and which of them are ticked. */
  let lookedUp = $state('');
  let picked = $state<string[]>([]);
  /** How the last Follow went for each feed, by address: followed, or why not. Shown under that feed. */
  let results = $state<Record<string, { ok: true } | { ok: false; why: string }>>({});
  /** Follow pressed with no collection to put the feed in: said under the new-collection box, which opens for it. */
  let noPlace = $state<string | null>(null);
  /** A first collection's name, sent with the follow so it's only made if the follow works. */
  let firstName = $state('');
  /** Feeds already here that match what's typed, and the row the arrow keys are on (-1: none, so Enter follows as usual). */
  let suggestions = $state<FeedSuggestion[]>([]);
  let active = $state(-1);
  /** The address a suggestion filled in. It isn't searched for again as if it were still being typed. */
  let pickedUrl = $state<string | null>(null);
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  let suggestAbort: AbortController | null = null;
  const listId = 'add-feed-suggestions';

  /* The feeds to choose from, for as long as the address box still holds the
     address they came from. Edit the address and Follow looks it up afresh. */
  const candidates = $derived(
    outcome && !('error' in outcome) && outcome.status === 'choose' && url.trim() === lookedUp ? outcome.candidates : null
  );

  /* Both ways this can go wrong are about the address, so they belong under
     the address box. "More than one feed here" isn't a failure and stays a
     list further down. */
  const urlError = $derived(
    outcome && 'error' in outcome
      ? outcome.error
      : outcome?.status === 'none'
        // Some big sites (CNN, for one) have quietly stopped publishing feeds,
        // so say that can happen instead of implying the address was wrong.
        ? `We couldn’t find a feed at ${hostOf(outcome.pageUrl)}. Not every site publishes one. If it has a blog or news page, try that page’s address.`
        : null
  );

  /* Suggestions have no place while a lookup runs or once an address has turned up several feeds to choose from. */
  const showSuggestions = $derived(suggestions.length > 0 && !busy && !candidates);

  /** On each pause in typing, ask what's already here. Not for one letter, and not for an address a suggestion filled in. */
  function typed() {
    clearTimeout(suggestTimer);
    suggestAbort?.abort();
    active = -1;
    const q = url.trim();
    if (q.length < 2 || q === pickedUrl) { suggestions = []; return; }
    suggestTimer = setTimeout(async () => {
      const ctl = new AbortController();
      suggestAbort = ctl;
      try {
        const res = await api.suggestFeeds(q, ctl.signal);
        if (!ctl.signal.aborted && url.trim() === q) suggestions = res.feeds;
      } catch { /* A stale or failed lookup: the box works without suggestions. */ }
    }, 200);
  }

  /**
   * Put the suggested feed's address in the box. Nothing is followed until
   * Follow. With no collection to put it in, the next step is naming one, so
   * the cursor moves to the name box with the same reminder Follow would give.
   */
  async function pick(f: FeedSuggestion) {
    url = f.url; pickedUrl = f.url; suggestions = []; active = -1; outcome = null;
    api.event('feed_suggestion_picked', { feedId: f.id });
    await loadCollections();
    // Cleared first so the reminder arriving is what opens and focuses the name box, even if it was already showing.
    noPlace = null;
    await tick();
    noPlace = needsCollection(ids);
    if (!noPlace) input?.focus();
  }

  /** With suggestions showing, the arrow keys walk them, Enter takes the one they're on, and Escape closes the list rather than the sheet. */
  function keys(e: KeyboardEvent) {
    if (!showSuggestions) return;
    const n = suggestions.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = e.key === 'ArrowDown' ? (active + 1) % n : active < 0 ? n - 1 : (active - 1 + n) % n;
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      suggestions = []; active = -1;
    }
  }

  // Each open() resets the form from the options it was opened with.
  $effect(() => {
    void addFeed.nonce;
    const o = addFeed.opts;
    url = o.url ?? '';
    ids = [...(o.collectionIds ?? [])];
    outcome = null; busy = false; landing = false; noPlace = null; firstName = '';
    lookedUp = ''; picked = []; results = {};
    clearTimeout(suggestTimer); suggestAbort?.abort(); suggestions = []; active = -1; pickedUrl = null;
    // Opened from a collection, that one starts ticked. Opened from Everything,
    // nothing is ticked — leave it and Follow drops the feed in your default
    // collection, which the hint below spells out.
    // (The list centers that ticked row itself, since it is often below the fold.)
    void loadCollections().then((s) => { ids = ids.filter((id) => id !== s.rootId); });
    dialog?.showModal();
    // Untracked: the lookup reads and writes the form's own state, and this
    // reset should run once per open, not again each time that state changes.
    if (o.autoSubmit && o.url) untrack(() => void submit(o.url));
    else queueMicrotask(() => input?.focus());
  });

  function toggle(id: number) {
    ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    noPlace = null;
  }

  const hint = $derived(whereItGoes(ids));

  /** Any URL in. A page, a feed, a shared link from another app: the server figures it out. */
  async function submit(target = url) {
    if (candidates) return followPicked(candidates);
    const value = target.trim();
    if (!value || busy) return;
    noPlace = null;
    await loadCollections();
    const first = ids.length ? undefined : firstName.trim() || undefined;
    noPlace = first ? null : needsCollection(ids);
    if (noPlace) return;
    busy = true; outcome = null;
    try {
      const res = await api.addFeed(value, ids, first);
      outcome = res;
      if ('status' in res && res.status === 'choose') { lookedUp = value; picked = []; results = {}; }
      if ('status' in res && res.status === 'subscribed') {
        api.event('feed_added', { feedId: res.feed.id, alreadyFollowed: res.alreadyFollowed, collectionIds: ids, via: addFeed.opts.via ?? 'sheet', suggested: value === pickedUrl });
        const name = res.feed.title ?? hostOf(res.feed.url);
        // A YouTube channel followed while its feed wasn't answering: say why its page is empty for now.
        if (res.waiting) showToast(`Following ${name}. YouTube’s feeds aren’t answering right now, so its videos will show up once they are.`, undefined, 10000);
        else showToast(res.alreadyFollowed ? `Already following ${name}` : `Following ${name}`);
        void loadCollections(true);
        landing = true;
        dialog?.close();
        await goto(feedHref(res.feed));
      }
    } catch (e) {
      outcome = { error: sayWhy(e) };
    } finally {
      busy = false;
    }
  }

  /**
   * Why a request failed, for the reader. The server words its own refusals;
   * anything else means the request never got a proper answer from thicket
   * (offline, or the server is restarting), which we say here.
   */
  function sayWhy(e: unknown): string {
    if (e instanceof ApiError && !/^HTTP \d+$/.test(e.message)) return e.message;
    return navigator.onLine ? 'thicket isn’t answering right now. Try again in a minute.' : 'You’re offline. Reconnect and try again.';
  }

  function togglePick(u: string) {
    picked = picked.includes(u) ? picked.filter((x) => x !== u) : [...picked, u];
  }

  /**
   * Follow every ticked feed, one after another. One feed lands on its own
   * page, as adding a single feed does. Several leave you where you were, with
   * a toast. If some fail the sheet stays open: each failed feed stays ticked
   * with its reason underneath, so Follow tries just those again, and each
   * followed one says so.
   */
  async function followPicked(list: NonNullable<typeof candidates>) {
    const chosen = list.filter((c) => picked.includes(c.url));
    if (!chosen.length || busy) return;
    busy = true;
    const done: Feed[] = [];
    const missed: string[] = [];
    const next = { ...results };
    for (const c of chosen) {
      try {
        // A first collection's name goes with the first feed; the rest file into what it made.
        const first = ids.length ? undefined : firstName.trim() || undefined;
        const res = await api.addFeed(c.url, ids, first);
        if (first && 'status' in res && res.status === 'subscribed') {
          await loadCollections(true);
          const made = namedCollections().find((x) => x.name === first);
          if (made) { ids = [made.id]; firstName = ''; }
        }
        if ('status' in res && res.status === 'subscribed') {
          // Two addresses can lead to one feed; count it once.
          if (!done.some((f) => f.id === res.feed.id)) done.push(res.feed);
          api.event('feed_added', { feedId: res.feed.id, alreadyFollowed: res.alreadyFollowed, collectionIds: ids, via: addFeed.opts.via ?? 'sheet' });
          next[c.url] = { ok: true };
        } else {
          missed.push(c.url);
          next[c.url] = { ok: false, why: 'error' in res ? res.error : 'There’s no feed at this address.' };
        }
      } catch (e) {
        missed.push(c.url);
        next[c.url] = { ok: false, why: sayWhy(e) };
      }
    }
    if (done.length) void loadCollections(true);
    busy = false;
    if (missed.length) {
      picked = missed;
      results = next;
      return;
    }
    showToast(done.length === 1 ? `Following ${done[0].title ?? hostOf(done[0].url)}` : `Following ${done.length} feeds`);
    landing = done.length === 1;
    dialog?.close();
    if (done.length === 1) await goto(feedHref(done[0]));
  }

  /** Closing from /add (the share target) has nothing underneath; go home. */
  function onclose() {
    closeAddFeed();
    if (!landing && page.url.pathname === '/add') void goto('/new-posts', { replaceState: true });
  }
</script>

<Sheet title="Add a feed" lede="Enter the address of a site, blog, subreddit, or YouTube channel or video, and thicket finds the feed for you. You can also enter the feed itself." bind:dialog {onclose}>
  <!-- A plain text box with the URL keyboard, not type="url": the browser's own
       URL check rejects "example.com" (it wants https:// in front), yet that is
       how people type an address and what the box suggests, and a box that
       suggests from a list is a combobox, which only a text box can be. The
       server adds https:// itself, and says so under the box if there's really
       nothing there. novalidate keeps the browser from blocking Enter on "required". -->
  <form id="add-feed" class="form" novalidate onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <Field label="Address" hideLabel error={urlError}>
      {#snippet children({ id, describedBy, invalid })}
        <Input
          {id}
          aria-describedby={describedBy}
          {invalid}
          bind:element={input}
          bind:value={url}
          inset
          type="text"
          inputmode="url"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={listId}
          aria-activedescendant={showSuggestions && active >= 0 ? `${listId}-${active}` : undefined}
          oninput={typed}
          onkeydown={keys}
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          placeholder="example.com"
          required
          disabled={busy}
        />
      {/snippet}
    </Field>

    {#if showSuggestions}
      <!-- Rows, not a floating menu: inside a sheet on a phone, with the keyboard up, there's no room to float anything. -->
      <ul class="suggestions" id={listId} role="listbox" aria-label="Feeds already on thicket">
        {#each suggestions as f, i (f.id)}
          <!-- The keyboard works the list from the box (aria-activedescendant), so a row itself only needs the pointer.
               A row goes active when the pointer moves over it, not merely by being under it: the list appears under the
               box, where the pointer often rests after opening the sheet, and Enter would then pick that row instead of following. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li id="{listId}-{i}" role="option" aria-selected={i === active} class:active={i === active}
            onmousedown={(e) => e.preventDefault()} onclick={() => pick(f)} onmousemove={() => (active = i)}>
            <strong>{f.title ?? hostOf(f.siteUrl ?? f.url)}</strong>
            <span>{f.url}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if candidates}
      <div class="result" role="group" aria-labelledby="add-feed-pick">
        <p id="add-feed-pick">There’s more than one feed here. Select the ones you want.</p>
        <ul class="candidates">
          {#each candidates as c (c.url)}
            {@const r = results[c.url]}
            <li>
              <label>
                <Checkbox checked={r?.ok || picked.includes(c.url)} onchange={() => togglePick(c.url)} disabled={busy || r?.ok} aria-describedby={r ? `pick-${c.url}` : undefined} />
                <span class="which">
                  <strong>{c.title ?? hostOf(c.url)}</strong>
                  <span>{c.note ?? c.url}</span>
                  {#if r?.ok}<span id="pick-{c.url}">Following</span>
                  {:else if r}<span id="pick-{c.url}" class="pick-error" role="alert">Not followed. {r.why}</span>{/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="eyebrow">Put it in a collection</div>
    {#key addFeed.nonce}
      <CollectionList {ids} {hint} error={noPlace} via="add_sheet" disabled={busy} ontoggle={toggle} oncreated={(id) => (ids = [...ids, id])} bind:draft={firstName} onfirst={() => void submit()} />
    {/key}
  </form>
  {#snippet footer()}
    <Button variant="primary" size="lg" type="submit" form="add-feed" disabled={busy || !url.trim() || (!!candidates && !picked.length)}>{busy ? (candidates ? 'Following…' : 'Looking…') : candidates && picked.length > 1 ? `Follow ${picked.length} feeds` : 'Follow'}</Button>
  {/snippet}
</Sheet>

<style>
  /* The form is only here to make Enter submit; its children lay out as the Sheet's own. */
  .form { display: contents; }
  .result { margin: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .result p { margin: 0 0 var(--space-2); }
  .candidates { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  /* The same tick box and spacing as the collection rows below. */
  .candidates label { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--line); cursor: pointer; }
  .which { display: flex; flex-direction: column; /* 2px is an optical gap between a name and its address. */ gap: 2px; min-width: 0; }
  .which strong { color: var(--text); }
  .which span { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); overflow-wrap: anywhere; }
  .which .pick-error { color: var(--danger); }
  /* The same rows as the candidates above, minus the tick box: pressing one is the choice. */
  .suggestions { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .suggestions li { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: var(--space-3); border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--line); cursor: pointer; }
  .suggestions li.active { background: var(--surface-2); box-shadow: inset 3px 0 0 var(--accent); }
  .suggestions strong { color: var(--text); font-size: calc(var(--text-sm) * var(--size-app)); }
  .suggestions span { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); overflow-wrap: anywhere; }
  .eyebrow { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); margin-top: var(--space-1); }
</style>
