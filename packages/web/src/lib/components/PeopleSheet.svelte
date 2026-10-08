<script lang="ts">
  /**
   * The people a person follows, or (on your own profile) the people who
   * follow you, opened from the counts beside the handle. Who follows you is
   * yours alone (issue #191): the server refuses that list to anyone else.
   * Only people with public profiles are named, the same ones the counts add up.
   */
  import Sheet from './Sheet.svelte';
  import Avatar from './Avatar.svelte';
  import { profilesApi, type PublicUser } from '$lib/api';

  let { handle, which, isMe, onclose }: { handle: string; which: 'following' | 'followers'; isMe: boolean; onclose: () => void } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let list = $state<PublicUser[] | null>(null);
  let failed = $state<string | null>(null);
  $effect(() => { dialog?.showModal(); });
  $effect(() => {
    const ask = which === 'following' ? profilesApi.following(handle) : profilesApi.followers(handle);
    ask.then((r) => (list = r.users)).catch((e) => (failed = e instanceof Error ? e.message : String(e)));
  });
</script>

<Sheet title={which === 'following' ? 'Following' : 'Followers'} bind:dialog {onclose}>
  {#if which === 'followers'}
    <p class="status">Only you can see who follows you. Following you doesn’t show them anything you haven’t shared with everyone.</p>
  {/if}
  {#if failed}
    <p class="status">{failed}</p>
  {:else if list === null}
    <p class="status">Loading…</p>
  {:else if list.length === 0}
    <p class="status">{which === 'followers' ? 'No one is following you yet.' : isMe ? 'You aren’t following anyone yet. Open someone’s profile and press Follow.' : 'Not following anyone yet.'}</p>
  {:else}
    <ul class="list">
      {#each list as p (p.handle)}
        <li><a href="/@{p.handle}" onclick={() => dialog?.close()}>
          <Avatar handle={p.handle} name={p.displayName ?? p.handle} size={34} v={p.avatarUpdatedAt} />
          <span class="meta"><span class="name">{p.displayName ?? p.handle}</span><span class="desc">@{p.handle}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a></li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .status { margin: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  /* The list scrolls on its own, so the Sheet's title and close button stay put. */
  .list { list-style: none; margin: 0 calc(-1 * var(--space-4)); padding: 0; overflow-y: auto; min-height: 0; }
  li a { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  li:first-child a { border-top: 0; }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
</style>
