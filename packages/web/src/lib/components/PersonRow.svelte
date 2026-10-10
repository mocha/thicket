<script lang="ts">
  /**
   * The one row for a person in a list (Explore, the people someone follows),
   * so a person looks the same wherever they're listed. It follows the Feed
   * row: their name, with their @handle tight under it, both dark, since
   * together they say who this is; then their bio and the facts about them
   * (feeds, public collections), gray. Follow sits at the right when the
   * screen offers it, and drops under the text on a phone.
   *
   * Each fact shows only when the screen has it. Anything more a screen wants
   * to say (why a search found them) goes in `children`, under the facts.
   */
  import type { Snippet } from 'svelte';
  import { profileHref } from '$lib/api';
  import { plural } from '$lib/words';
  import Avatar from './Avatar.svelte';
  import Dot from './Dot.svelte';
  import FollowButton from './FollowButton.svelte';

  interface Props {
    person: { handle: string; displayName: string | null; bio: string | null; avatarUpdatedAt: string | null };
    feeds?: number;
    collections?: number;
    /** Whether you follow them. Left off, the row has no Follow button. */
    following?: boolean;
    busy?: boolean;
    onfollow?: () => void;
    onopen?: () => void;
    children?: Snippet;
  }

  let { person: u, feeds, collections, following, busy = false, onfollow, onopen, children }: Props = $props();

  const facts = $derived(
    [
      feeds !== undefined ? plural(feeds, 'feed') : null,
      collections !== undefined ? `${collections.toLocaleString()} public ${collections === 1 ? 'collection' : 'collections'}` : null
    ].filter((x): x is string => !!x)
  );
</script>

<li class="personrow">
  <a class="row tap" href={profileHref(u.handle)} onclick={() => onopen?.()}>
    <Avatar handle={u.handle} name={u.displayName ?? u.handle} size={40} v={u.avatarUpdatedAt} />
    <div class="meta">
      <span class="title row-name">{u.displayName ?? u.handle}</span>
      <span class="row-details handle">@{u.handle}</span>
      {#if u.bio}<span class="row-details bio">{u.bio}</span>{/if}
      {#if facts.length}
        <span class="row-details facts">{#each facts as fact, i (i)}{#if i > 0}{' '}<Dot />{' '}{/if}{fact}{/each}</span>
      {/if}
      {@render children?.()}
    </div>
  </a>
  {#if following !== undefined}
    <FollowButton {following} {busy} onclick={onfollow} />
  {/if}
</li>

<style>
  .personrow { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The handle is part of who they are, so it reads dark with the name, tight
     under it like a byline. The -2px is optical: it takes back some of the
     empty space above and below each line of text, so the two read as a pair. */
  .handle { margin-top: -2px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bio { margin-top: var(--space-1); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .facts { margin-top: var(--space-1); }
  /* Last, so it wins over the row's own sizing above. On a phone the button
     would squeeze the bio into a column four words wide, so it drops to its
     own line, at the right, and the text gets the row. */
  @media (max-width: 560px) {
    .row { flex-basis: 100%; }
    .personrow > :global(.follow) { margin-left: auto; }
  }
  @media (hover: hover) { .row:hover .title { text-decoration: underline; text-underline-offset: 3px; } }
</style>
