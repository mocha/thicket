<script lang="ts">
  /**
   * The one row for a collection in a list (Explore, a profile's Collections,
   * the collections inside a collection), so a collection looks the same
   * wherever it's listed. It follows the Feed and Person rows: the name, with
   * any badges after it (Yours, Copied, who can see it, how many new posts),
   * and whose it is tight under it, both dark; then its description and how
   * many feeds it holds, gray. The whole row opens it, so it ends in an arrow.
   *
   * A few of its feeds' icons, overlapped, are its picture. A collection
   * inside another steps in one spacing step per level (`depth`), and its
   * name sits quieter, so the tree reads at a glance. Anything more a screen
   * wants to say (why a search found it) goes in `children`, in place of the
   * plain feed count on the facts line, so the count isn't said twice.
   */
  import type { Snippet } from 'svelte';
  import type { CollectionSample } from '$lib/api';
  import { plural } from '$lib/words';
  import SourceIcon from './SourceIcon.svelte';

  interface Props {
    href: string;
    name: string;
    description?: string | null;
    feedCount: number;
    /** Whose it is, said as "by …"; left off on the owner's own profile. */
    owner?: string;
    /** A few of its feeds, drawn overlapped as its picture. */
    sample?: CollectionSample[];
    depth?: number;
    badges?: Snippet;
    children?: Snippet;
  }

  let { href, name, description, feedCount, owner, sample, depth = 0, badges, children }: Props = $props();
</script>

<li class="colrow" class:nested={depth > 0}>
  <a class="row-link" {href} style:--depth={depth}>
    {#if sample}
      <span class="stack" aria-hidden="true">
        {#each sample.slice(0, 3) as s (s.id)}<SourceIcon feedId={s.id} hasIcon={s.hasIcon} name={s.title ?? '?'} size={22} />{/each}
      </span>
    {/if}
    <span class="meta">
      <span class="named"><span class="title row-name">{name}</span>{@render badges?.()}</span>
      {#if owner}<span class="row-details owner">by {owner}</span>{/if}
      {#if description}<span class="row-details desc">{description}</span>{/if}
      <span class="row-details facts">{#if children}{@render children()}{:else}{plural(feedCount, 'feed')}{/if}</span>
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </a>
</li>

<style>
  .colrow a { padding-left: calc(var(--card-pad, var(--space-4)) + var(--depth, 0) * var(--space-5)); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .named { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .named :global(.badge) { flex: none; }
  .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nested .title { font-weight: 500; color: var(--text-2); }
  /* Whose it is reads dark with the name, tight under it like a byline. The
     -2px is optical: it takes back some of the empty space above and below
     each line of text, so the two read as a pair. */
  .owner { margin-top: -2px; color: var(--text); }
  .desc { margin-top: var(--space-1); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  /* A step more room above the facts than between the other lines, so the description and the numbers read as two groups. */
  .facts { margin-top: var(--space-2); }
  .chev { flex: none; color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
  @media (hover: hover) { .row-link:hover .title { text-decoration: underline; text-underline-offset: 3px; } }
  .stack { display: inline-flex; flex: none; width: 40px; height: 40px; position: relative; }
  /* The overlapped icons are placed, not spaced: 9px centers them in the 40px box and steps each one across. */
  .stack :global(> *) { position: absolute; top: 9px; }
  .stack :global(> :nth-child(1)) { left: 0; z-index: 3; }
  .stack :global(> :nth-child(2)) { left: 9px; z-index: 2; }
  .stack :global(> :nth-child(3)) { left: 18px; z-index: 1; }
</style>
