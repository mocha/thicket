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

  let { heading = 'Start with one of these', lede = 'Copy one and its sites become yours — add to it, prune it, rename it. The copy is independent from that moment on.', compact = false }:
    { heading?: string; lede?: string; compact?: boolean } = $props();

  let packs = $state<(ExploreCollection & { isMine: boolean })[]>([]);
  /** The account these came from, when the instance names one. Worth crediting: it has a profile, and notes and bookmarks on it. */
  let from = $state<string | null>(null);
  let copying = $state<number | null>(null);
  let copied = $state<Set<number>>(new Set());

  onMount(() => {
    exploreApi.featured().then((r) => { packs = r.collections.filter((c) => !c.isMine); from = r.from; }).catch(() => {});
  });

  async function copy(c: ExploreCollection) {
    if (copying) return;
    copying = c.id;
    try {
      await profilesApi.copyCollection(c.handle, c.slug);
      copied = new Set([...copied, c.id]);
      await loadCollections();
      api.event('starter_pack_copied', { collectionId: c.id });
      showToast(`${c.name} is yours. Its posts are in your stream now.`);
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
        <li>
          <a class="card" href={collectionHref(c.handle, c.slug)}>
            <div class="icons">
              {#each c.sample as f (f.id)}<SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title} size={26} />{/each}
            </div>
            <div class="name">{c.name}</div>
            <div class="meta">{c.feedCount} {c.feedCount === 1 ? 'site' : 'sites'}{#if !from} · by {c.displayName ?? `@${c.handle}`}{/if}</div>
            {#if c.description}<div class="desc">{c.description}</div>{/if}
          </a>
          {#if session.user}
            <button type="button" class="take" disabled={copying === c.id || copied.has(c.id)} onclick={() => void copy(c)}>
              {#if copied.has(c.id)}Added{:else if copying === c.id}Copying…{:else}Copy to my collections{/if}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if from}
      <p class="from">These are <a href={profileHref(from)}>@{from}</a>’s collections — an ordinary account on this instance. Its page shows everything it reads, saves and notes, if you want a longer look before you pick.</p>
    {/if}
  </section>
{/if}

<style>
  .packs { margin: 0; }
  h2 { font-family: var(--font-headings); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 4px; }
  .lede { margin: 0 0 16px; color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); max-width: 60ch; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  li { display: flex; flex-direction: column; }
  .card { display: block; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; flex: 1; }
  .card:hover { border-color: var(--accent); }
  .icons { display: flex; gap: 5px; margin-bottom: 9px; min-height: 26px; }
  .name { font-weight: 700; font-size: calc(var(--text-base) * var(--size-app)); }
  .meta { color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); margin-top: 2px; }
  .desc { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); margin-top: 7px; }
  .take { margin-top: 8px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .take:hover:not(:disabled) { border-color: var(--accent); }
  .take:disabled { opacity: 0.55; color: var(--text-3); }
  .from { margin: 14px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.5; max-width: 62ch; }
  .from a { color: var(--accent); font-weight: 600; }
  .compact h2 { font-size: calc(var(--text-xl) * var(--size-app)); }
  .compact .desc { display: none; }
  @media (min-width: 700px) { ul { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1100px) { ul { grid-template-columns: repeat(3, 1fr); } .compact ul { grid-template-columns: repeat(2, 1fr); } }
</style>
