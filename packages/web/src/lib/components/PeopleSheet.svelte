<script lang="ts">
  /**
   * The people a person follows, or (on your own profile) the people who
   * follow you, opened from the counts beside the handle. Who follows you is
   * yours alone (issue #191): the server refuses that list to anyone else.
   * Only people with public profiles are named, the same ones the counts add up.
   */
  import Sheet from './Sheet.svelte';
  import PeopleList from './PeopleList.svelte';
  import { profilesApi, type PublicUser } from '$lib/api';

  /** `people`: the list, when the caller already has it, so it isn't fetched again. */
  let { handle, which, isMe, people, onclose }: { handle: string; which: 'following' | 'followers'; isMe: boolean; people?: PublicUser[]; onclose: () => void } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let list = $state<PublicUser[] | null>(null);
  let failed = $state<string | null>(null);
  $effect(() => { dialog?.showModal(); });
  $effect(() => {
    if (people) { list = people; return; }
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
    <div class="scroll"><PeopleList people={list} onopen={() => dialog?.close()} /></div>
  {/if}
</Sheet>

<style>
  .status { margin: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  /* The list scrolls on its own, so the Sheet's title and close button stay put. */
  .scroll { margin: 0 calc(-1 * var(--space-4)); overflow-y: auto; min-height: 0; }
</style>
