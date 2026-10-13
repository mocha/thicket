<script lang="ts">
  /**
   * The one row for a person in a list (Explore, the people someone follows),
   * so a person looks the same wherever they're listed. It follows the Feed
   * row: their name with their @handle beside it in gray, as a note names its
   * writer; then their bio and the facts about them (feeds, public
   * collections), gray. Follow sits at the right when the screen offers it,
   * and drops under the text on a phone. On your own row (`me`) an "It's you!"
   * Badge sits there instead, in Following's soft green, with nothing to press.
   *
   * Each fact shows only when the screen has it. Anything more a screen wants
   * to say (why a search found them) goes in `children`, on a line of its own
   * under the facts, so neither line runs long.
   */
  import type { Snippet } from 'svelte';
  import { profileHref } from '$lib/api';
  import { plural } from '$lib/words';
  import Avatar from './Avatar.svelte';
  import Badge from './Badge.svelte';
  import Dot from './Dot.svelte';
  import FollowButton from './FollowButton.svelte';

  interface Props {
    person: { handle: string; displayName: string | null; bio: string | null; avatarUpdatedAt: string | null };
    feeds?: number;
    collections?: number;
    /** Whether you follow them. Left off, the row has no Follow button. */
    following?: boolean;
    /** The row is you: "It's you!" in place of Follow. */
    me?: boolean;
    busy?: boolean;
    onfollow?: () => void;
    onopen?: () => void;
    children?: Snippet;
  }

  let { person: u, feeds, collections, following, me = false, busy = false, onfollow, onopen, children }: Props = $props();

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
      <!-- Name and handle as a note heads them: "Priya Nair (@priya)", or just the handle when they gave no name. -->
      <span class="title row-name">{#if u.displayName}{u.displayName} <span class="handle">(@{u.handle})</span>{:else}@{u.handle}{/if}</span>
      {#if u.bio}<span class="row-details bio">{u.bio}</span>{/if}
      {#if facts.length || children}
        <span class="facts">
          {#if facts.length}<span class="row-details">{#each facts as fact, i (i)}{#if i > 0}{' '}<Dot />{' '}{/if}{fact}{/each}</span>{/if}
          {#if children}<span class="row-details">{@render children()}</span>{/if}
        </span>
      {/if}
    </div>
  </a>
  {#if me}
    <Badge tone="soft" class="me">It’s you!</Badge>
  {:else if following !== undefined}
    <FollowButton {following} {busy} onclick={onfollow} />
  {/if}
</li>

<style>
  .personrow { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .handle { font-weight: 400; color: var(--text-2); }
  /* Close under the name, so the two read as a pair, as on the Collection row. */
  .bio { margin-top: -2px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  /* A step more room above the facts than between the other lines, so the description and the numbers read as two groups. */
  .facts { margin-top: var(--space-2); display: flex; flex-direction: column; }
  /* Last, so it wins over the row's own sizing above. On a phone the button
     would squeeze the bio into a column four words wide, so it drops to its
     own line, at the right, and the text gets the row. */
  @media (max-width: 560px) {
    .row { flex-basis: 100%; }
    .personrow > :global(.follow), .personrow > :global(.me) { margin-left: auto; }
  }
  @media (hover: hover) { .row:hover .title { text-decoration: underline; text-underline-offset: 3px; } }
</style>
