<script lang="ts">
  /**
   * Starter packs: the instance's answer to an empty screen.
   *
   * A person who has just signed up follows nothing, and "Add a feed" asks
   * them to already know an address worth pasting. These are collections
   * somebody here has made public, offered as a first move: copy one and your
   * stream has something in it before you have learned what a feed is. The
   * copy is independent from that moment on — it is yours to add to and prune.
   *
   * Shown signed out too (the sign-up page), where each card is a link: "here,
   * copy mine" has to work as something you can send to a friend.
   */
  import { onMount } from 'svelte';
  import { api, exploreApi, profilesApi, collectionHref, profileHref, type ExploreCollection } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { loadCollections } from '$lib/collections.svelte';
  import SourceIcon from './SourceIcon.svelte';
  import Card from './Card.svelte';
  import Button from './Button.svelte';

  let { heading = 'Start with one of these', lede = 'Copy one and its sites become yours — add to it, prune it, rename it. The copy is independent from that moment on.', compact = false }:
    { heading?: string; lede?: string; compact?: boolean } = $props();

  let packs = $state<(ExploreCollection & { isMine: boolean })[]>([]);
  /** The account these came from, when the instance names one. Worth crediting: it has a profile, and notes and bookmarks on it. */
  let from = $state<string | null>(null);
  let copying = $state<number | null>(null);
  let copied = $state<Set<number>>(new Set());

  onMount(() => {
    exploreApi.featured().then((r) => {
      packs = r.collections.filter((c) => !c.isMine);
      from = r.from;
    }).catch(() => {});
  });

  async function copy(c: ExploreCollection) {
    if (copying) return;
    copying = c.id;
    try {
      await profilesApi.copyCollection(c.handle, c.slug);
      copied = new Set([...copied, c.id]);
      // Forced: the sidebar's list is already loaded, and without it the new collection wouldn't show until a reload.
      await loadCollections(true);
      api.event('starter_pack_copied', { collectionId: c.id });
      showToast(`${c.name} is now in your collections.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'That didn’t work. Try again in a moment.');
    } finally {
      copying = null;
    }
  }
</script>

{#if packs.length}
  <section class="packs" class:compact>
    <h2>{heading}</h2>
    {#if lede}<p class="lede">{lede}</p>{/if}
    <ul>
      {#each packs as c (c.id)}
        <Card as="li" class="pack">
          <!-- Laid out like an article card: a small line on top (here, the
               sites inside and how many), then the title, then
               the summary. -->
          <div class="meta">
            <span class="icons" aria-hidden="true">
              {#each c.sample as f (f.id)}<SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title} size={20} />{/each}
            </span>
            <span class="count">{c.feedCount} {c.feedCount === 1 ? 'site' : 'sites'}{#if !from}{' · '}{c.displayName ?? `@${c.handle}`}{/if}</span>
          </div>
          <!-- The name is the link, stretched over the whole card, so the card
               still opens the collection while the button below stays its own control. -->
          <h3 class="card-title"><a class="name" href={collectionHref(c.handle, c.slug)}>{c.name}</a></h3>
          {#if c.description}<p class="card-summary">{c.description}</p>{/if}
          {#if session.user}
            <div class="take">
              <Button variant="secondary" size="sm" loading={copying === c.id} disabled={copied.has(c.id)} onclick={() => void copy(c)}>
                {#if copied.has(c.id)}Added{:else if copying === c.id}Copying…{:else}<span aria-hidden="true">+</span> Copy to my collections{/if}
              </Button>
            </div>
          {/if}
        </Card>
      {/each}
    </ul>
    {#if from}
      <p class="from">These are <a href={profileHref(from)}>@{from}</a>’s collections.</p>
    {/if}
  </section>
{/if}

<style>
  .packs { margin: 0; }
  h2 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-1); }
  /* With no lede, the heading needs its own room above the cards. */
  h2 + ul { margin-top: var(--space-4); }
  .lede { margin: 0 0 var(--space-4); color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); max-width: 60ch; }
  /* As many columns as fit, with every card wide enough for its button's
     label and its small line of icons, count, and name. Counted from the space
     the list really has, not the window, so the sidebar can't squeeze three
     cards into room for two. */
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(17rem * var(--size-app))), 1fr)); }
  ul :global(.pack) { display: flex; flex-direction: column; }
  /* Pressing the button presses the button, not the card: the card's own
     press shrink is for opening the collection. */
  ul :global(.pack:has(.take:active)) { transform: none; }
  /* The same small line an article card opens with: 14px, secondary ink. */
  .meta { display: flex; align-items: center; gap: var(--space-2); min-width: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  /* Side by side, not stacked: site icons are rounded squares, and overlapping
     them clips their letters. */
  .icons { display: flex; flex: none; gap: var(--space-1); }
  /* One line, like an article card's: a long name trails off rather than wrapping. */
  .count { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Written as "after the small line" so it outranks the shared card title's own zero margin. */
  .meta + .card-title { margin-top: var(--space-2); }
  .name { color: inherit; text-decoration: none; }
  /* The article card's cue that the card opens something: the title underlines
     softly while the pointer is anywhere on the card but the button. */
  @media (hover: hover) { .name:hover { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  .name::after { content: ''; position: absolute; inset: 0; }
  .name:focus-visible { outline: none; }
  ul :global(.pack:has(.name:focus-visible)) { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* Pinned to the bottom so the buttons line up across a row of uneven cards,
     and lifted above the stretched link so a tap lands on the button. */
  .take { margin-top: auto; padding-top: var(--space-3); position: relative; z-index: 1; }
  .from { margin: var(--space-4) 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.5; max-width: 62ch; }
  .from a { color: var(--accent); font-weight: 600; }
  .compact h2 { font-size: calc(var(--text-xl) * var(--size-app)); }
  .compact .card-summary { display: none; }
  .compact ul { grid-template-columns: 1fr; }
  @media (min-width: 700px) { .compact ul { grid-template-columns: repeat(2, 1fr); } }
</style>
