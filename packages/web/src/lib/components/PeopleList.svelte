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

<ul class="list-rows">
  {#each people as p (p.handle)}
    <li><a class="row-link" href="/@{p.handle}" onclick={() => onopen?.()}>
      <Avatar handle={p.handle} name={p.displayName ?? p.handle} size={40} v={p.avatarUpdatedAt} />
      <span class="meta"><span class="name row-name">{p.displayName ?? p.handle}</span><span class="desc row-details">@{p.handle}</span></span>
      <span class="chev" aria-hidden="true">›</span>
    </a></li>
  {/each}
</ul>

<style>
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
</style>
