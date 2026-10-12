<script lang="ts">
  /**
   * The face of a feed in a list: its site's icon, then its name with an
   * optional badge beside it and the site it's from tight under the name.
   * Anything more (a description, facts, why it can't be added) is passed as
   * children and lands under those two lines.
   *
   * The Feed row (FeedRow) wraps this in a link with Follow at the end; the
   * Import review uses it bare, for feeds thicket may never have seen, with
   * their status at the end instead. Both read the same because they are the
   * same piece. It draws two things side by side, the icon and the text, so
   * the caller's row lays them out (flex, centered, the row gap).
   */
  import type { Snippet } from 'svelte';
  import SourceIcon from './SourceIcon.svelte';

  interface Props {
    /** The saved feed, for its icon; null for one thicket hasn't saved, which shows its initial. */
    feedId: number | null;
    hasIcon?: boolean;
    /** The feed's name, for its icon's initial and, unless `label` is given, the line itself. */
    name: string;
    /** The name as the list shows it, when that differs (a renamed feed, or two with the same title). */
    label?: string;
    /** The site line under the name, left off when empty. */
    origin?: string | null;
    /** Beside the name: a Failing badge, say. */
    badge?: Snippet;
    children?: Snippet;
  }

  let { feedId, hasIcon = false, name, label, origin = null, badge, children }: Props = $props();
</script>

<SourceIcon {feedId} {hasIcon} {name} size={40} />
<div class="meta">
  <span class="named"><span class="title row-name">{label ?? name}</span>{@render badge?.()}</span>
  {#if origin}<span class="row-details origin">{origin}</span>{/if}
  {@render children?.()}
</div>

<style>
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .named { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The site is part of who the feed is, so it reads dark with the name, tight
     under it like a byline. The -2px is optical: it takes back some of the
     empty space above and below each line of text, so the two read as a pair. */
  .origin { margin-top: -2px; color: var(--text); overflow-wrap: anywhere; }
</style>
