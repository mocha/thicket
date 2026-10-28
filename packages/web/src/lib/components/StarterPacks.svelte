<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  /**
   * Starter packs: the instance's answer to an empty screen.
   *
   * A person who has just signed up follows nothing, and "Add a feed" asks
   * them to already know an address worth pasting. These are collections
   * somebody here has made public, offered as a first move: copy one and your
   * stream has something in it before you have learned what a feed is. The
   * copy is independent from that moment on — it is yours to add to and prune.
   *
   * The cards are for picking (StarterWelcome): a checkbox in each card's top
   * right corner, the whole card its label, and the page copies everything
   * ticked with one button. `available` says how many there are, so the page
   * knows whether to offer that button at all, and `loaded` that the answer is
   * in (so "none" isn't said while they're still on the way).
   */
  import { onMount } from 'svelte';
  import { exploreApi, type ExploreCollection } from '$lib/api';
  import SourceIcon from './SourceIcon.svelte';
  import Card from './Card.svelte';
  import CardMeta from './CardMeta.svelte';
  import Checkbox from './Checkbox.svelte';
  import { plural } from '$lib/words';

  let { heading = 'Start with one of these', lede = 'Copy one and its sites become yours — add to it, prune it, rename it. The copy is independent from that moment on.', compact = false, picked = $bindable([]), available = $bindable(0), loaded = $bindable(false) }:
    { heading?: string; lede?: string; compact?: boolean; picked?: ExploreCollection[]; available?: number; loaded?: boolean } = $props();

  const isPicked = (c: ExploreCollection) => !!picked?.some((p) => p.id === c.id);
  function toggle(c: ExploreCollection) {
    picked = isPicked(c) ? picked!.filter((p) => p.id !== c.id) : [...(picked ?? []), c];
  }

  let packs = $state<(ExploreCollection & { isMine: boolean })[]>([]);
  /** The account these came from, when the instance names one. Worth crediting: it has a profile, and notes and bookmarks on it. */
  let from = $state<string | null>(null);

  onMount(() => {
    exploreApi.featured().then((r) => {
      packs = r.collections.filter((c) => !c.isMine);
      from = r.from;
      available = packs.length;
    }).catch((e) => console.error('[starter packs] loading failed:', e)).finally(() => { loaded = true; });
  });
</script>

{#if packs.length}
  <section class="packs" class:compact>
    {#if heading}<h2>{heading}</h2>{/if}
    {#if lede}<p class="lede">{lede}</p>{/if}
    <ul>
      {#each packs as c (c.id)}
        <Card as="li" class="pack{isPicked(c) ? ' picked' : ''}" pad={false}>
          <!-- Laid out like an article card, with the same source line on top:
               here the sites inside, whose it is, and how many. When the
               instance names one account for all of them, that's said once
               under the list instead, so the line just counts the sites. -->
          <CardMeta feedId={null} name={from ? plural(c.feedCount, 'site') : (c.displayName ?? `@${c.handle}`)}>
            {#snippet icon()}<span class="icons" aria-hidden="true">{#each c.sample as f (f.id)}<SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title} size={20} />{/each}</span>{/snippet}
            {#if !from}<Dot /><span class="count">{plural(c.feedCount, 'site')}</span>{/if}
          </CardMeta>
          <!-- Picking: the box in the card's top right corner, and the name its
               label, stretched over the whole card, so a tap anywhere ticks it. -->
          <Checkbox class="tick" id="pack-{c.id}" checked={isPicked(c)} onchange={() => toggle(c)} />
          <h3 class="card-title"><label class="name" for="pack-{c.id}">{c.name}</label></h3>
          {#if c.description}<p class="card-summary">{c.description}</p>{/if}
        </Card>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .packs { margin: 0; }
  h2 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-1); }
  /* With no lede, the heading needs its own room above the cards. */
  h2 + ul { margin-top: var(--space-4); }
  .lede { margin: 0 0 var(--space-4); color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); max-width: 60ch; }
  /* As many columns as fit, with every card wide enough for its small line
     of icons, count, and name. Counted from the space
     the list really has, not the window, so the sidebar can't squeeze three
     cards into room for two. */
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(17rem * var(--size-app))), 1fr)); }
  /* An article card's insets. Its source line is a button with 4px of room
     around it, so its icons sit 16px from the top and its title 12px below;
     this line has no button, so the card's own padding says the same. */
  ul :global(.pack) { display: flex; flex-direction: column; padding: var(--card-pad); }
  /* Side by side, not stacked: site icons are rounded squares, and overlapping
     them clips their letters. */
  .icons { display: flex; flex: none; gap: var(--space-1); }
  /* One line, like an article card's: a long name trails off rather than wrapping. */
  .count { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* As far under the source line as an article card's title. Written this
     specifically so it outranks the shared title's own zero margin. */
  .packs ul .card-title { margin-top: var(--space-3); }
  .name { color: inherit; text-decoration: none; }
  .name::after { content: ''; position: absolute; inset: 0; }
  .name:focus-visible { outline: none; }
  label.name { cursor: pointer; }
  /* The box in the card's top right corner, in line with the source line,
     which stops short of it. */
  ul :global(.tick) { position: absolute; top: calc(var(--card-pad) + 2px); right: var(--card-pad); }
  ul :global(.pack:has(.tick) .meta) { padding-right: calc(16px + var(--space-3)); }
  ul :global(.pack:has(.tick input:focus-visible)) { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* Picked: outlined in the accent, the same green that says "you have this" elsewhere. */
  ul :global(.pack.picked) { outline: 2px solid var(--accent); outline-offset: -1px; }
  ul :global(.pack:has(.name:focus-visible)) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .compact h2 { font-size: calc(var(--text-xl) * var(--size-app)); }
  .compact .card-summary { display: none; }
  .compact ul { grid-template-columns: 1fr; }
  @media (min-width: 700px) { .compact ul { grid-template-columns: repeat(2, 1fr); } }
</style>
