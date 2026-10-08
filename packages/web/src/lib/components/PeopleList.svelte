<script lang="ts">
  /**
   * A list of people: picture, name, and handle, each opening their profile.
   * Used for who someone follows (and your followers) in the people Sheet, and
   * on an empty profile's Overview, where it gives a visitor somewhere to go.
   */
  import Avatar from './Avatar.svelte';
  import type { PublicUser } from '$lib/api';

  let { people, onopen }: { people: PublicUser[]; onopen?: () => void } = $props();
</script>

<ul class="list">
  {#each people as p (p.handle)}
    <li><a href="/@{p.handle}" onclick={() => onopen?.()}>
      <Avatar handle={p.handle} name={p.displayName ?? p.handle} size={34} v={p.avatarUpdatedAt} />
      <span class="meta"><span class="name">{p.displayName ?? p.handle}</span><span class="desc">@{p.handle}</span></span>
      <span class="chev" aria-hidden="true">›</span>
    </a></li>
  {/each}
</ul>

<style>
  .list { list-style: none; margin: 0; padding: 0; }
  li a { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  li:first-child a { border-top: 0; }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
</style>
