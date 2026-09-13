<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, profilesApi, publicCollectionHref, type Profile } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { hostOf } from '$lib/time';
  import Monogram from '$lib/components/Monogram.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { goto } from '$app/navigation';
  import { collectionsApi, collectionHref } from '$lib/api';
  import { loadCollections } from '$lib/collections.svelte';

  /** On your own profile the Collections section is also where you make one. */
  let creating = $state(false);
  let newName = $state('');
  let newBusy = $state(false);
  let newInput = $state<HTMLInputElement | null>(null);
  async function createCollection() {
    const name = newName.trim();
    if (!name || newBusy || !session.user) return;
    newBusy = true;
    try {
      const c = await collectionsApi.create(name);
      api.event('collection_created', { collectionId: c.id, via: 'profile' });
      await loadCollections(true);
      creating = false; newName = '';
      await goto(collectionHref(session.user.handle, c.slug));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      newBusy = false;
    }
  }

  /** Follow a person: one-directional, nothing is sent to them. Their notes start showing on your posts (if you let them). */
  let followBusy = $state(false);
  async function toggleFollow() {
    if (!profile || profile.private || followBusy) return;
    followBusy = true;
    const was = profile.people.isFollowing;
    try {
      const r = was ? await profilesApi.unfollow(profile.handle) : await profilesApi.follow(profile.handle);
      profile.people = { ...profile.people, isFollowing: r.isFollowing, followers: profile.people.followers + (r.isFollowing ? 1 : -1) };
      api.event(r.isFollowing ? 'user_followed' : 'user_unfollowed', { handle: profile.handle });
      showToast(r.isFollowing ? `Following ${profile.displayName ?? '@' + profile.handle}. Their notes will show on posts you both see.` : `Unfollowed ${profile.displayName ?? '@' + profile.handle}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      followBusy = false;
    }
  }

  /**
   * A person's public page. What shows depends on what they chose to share:
   * the whole profile, then collections and bookmarks as sections. The owner
   * sees everything plus a note about what others can and can't see.
   */
  const handle = $derived(page.params.handle ?? '');
  let profile = $state<Profile | null>(null);
  let error = $state<string | null>(null);
  let loadedHandle = $state<string | undefined>(undefined);
  const isMe = $derived(!!profile && !profile.private && profile.isMe);
  $effect(() => { if (isMe) void loadCollections(); });

  $effect(() => {
    if (loadedHandle === handle) return;
    loadedHandle = handle;
    profile = null; error = null;
    profilesApi.get(handle).then((p) => (profile = p)).catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });
  onMount(() => api.event('profile_view', { handle }));

  const joined = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  /**
   * What the owner is told about their own page: one sentence per section that
   * isn't shown to everyone, so "who can actually see this" never needs a trip
   * to Settings to answer.
   */
  const NAMES = { collections: 'collections', bookmarks: 'bookmarks', notes: 'notes' } as const;
  const narrowed = $derived.by(() => {
    const v = profile && !profile.private ? profile.visibility : undefined;
    if (!v) return [];
    const out: string[] = [];
    for (const k of ['collections', 'bookmarks', 'notes'] as const) {
      if (v[k] === 'private') out.push(`Nobody else sees your ${NAMES[k]}.`);
      else if (v[k] === 'friends') out.push(`Only the people you follow see your ${NAMES[k]}.`);
    }
    return out;
  });
</script>

<svelte:head><title>@{handle} · thicket</title></svelte:head>

{#if error}
  <div class="empty"><h1>@{handle}</h1><p>{error === 'not found' ? 'No one here by that handle.' : error}</p></div>
{:else if !profile}
  <p class="status">Loading…</p>
{:else if profile.private}
  <div class="empty">
    <Monogram name={profile.handle} size={64} />
    <h1>@{profile.handle}</h1>
    <p>This profile is private.</p>
  </div>
{:else}
  <header class="who">
    <Monogram name={profile.displayName ?? profile.handle} size={72} />
    <div class="names">
      <h1>{profile.displayName ?? profile.handle}</h1>
      <p class="handle">@{profile.handle}</p>
      {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}
      <p class="meta">
        {#if profile.homepageUrl}<a href={profile.homepageUrl} target="_blank" rel="noopener me">{hostOf(profile.homepageUrl)} ↗</a> · {/if}
        Follows {profile.following} {profile.following === 1 ? 'feed' : 'feeds'}{#if profile.people.follows} and {profile.people.follows} {profile.people.follows === 1 ? 'person' : 'people'}{/if}
        · Joined {joined(profile.createdAt)}
      </p>
    </div>
    {#if profile.isMe}
      <a class="btn" href="/settings">Edit profile</a>
    {:else if session.user}
      <button class="btn" class:following={profile.people.isFollowing} onclick={toggleFollow} disabled={followBusy} aria-pressed={profile.people.isFollowing}>{profile.people.isFollowing ? 'Following' : 'Follow'}</button>
    {:else}
      <a class="btn" href="/login?next={encodeURIComponent(page.url.pathname)}">Follow</a>
    {/if}
  </header>

  {#if profile.isMe && profile.visibility}
    {#if profile.visibility.profile === 'private'}
      <p class="note">Your profile is <strong>private</strong>. Only you can see this page. <a href="/settings">Change</a></p>
    {:else if narrowed.length}
      <p class="note">{narrowed.join(' ')} <a href="/settings">Change</a></p>
    {/if}
  {/if}

  {#if profile.collections}
    <section>
      <h2>Collections <span class="n">{profile.collections.length}</span></h2>
      {#if profile.collections.length === 0 && !profile.isMe}
        <p class="status">No collections to show.</p>
      {:else}
        <ul class="list">
          {#each profile.collections as c (c.id)}
            <li>
              <a href={publicCollectionHref(profile.handle, c.slug)}>
                <div class="meta2">
                  <span class="name">{c.name}{#if profile.isMe && !c.isPublic} <span class="tag">Private</span>{/if}</span>
                  {#if c.description}<span class="desc">{c.description}</span>{/if}
                </div>
                <span class="count">{c.feedCount} {c.feedCount === 1 ? 'feed' : 'feeds'}</span>
                <span class="chev" aria-hidden="true">›</span>
              </a>
            </li>
          {/each}
          {#if profile.isMe}
            <li class="new">
              {#if creating}
                <form onsubmit={(e) => { e.preventDefault(); void createCollection(); }}>
                  <input bind:this={newInput} type="text" bind:value={newName} placeholder="Name it, e.g. News" maxlength="60" disabled={newBusy} aria-label="New collection name" onkeydown={(e) => { if (e.key === 'Escape') creating = false; }} />
                  <button type="submit" disabled={newBusy || !newName.trim()}>{newBusy ? 'Creating…' : 'Create'}</button>
                </form>
              {:else}
                <button class="add" onclick={() => { creating = true; queueMicrotask(() => newInput?.focus()); }}><span class="plus" aria-hidden="true">+</span> New collection</button>
              {/if}
            </li>
          {/if}
        </ul>
        {#if profile.collections.length === 0 && profile.isMe}
          <p class="status">A collection is a handful of feeds you read together. Make one above, then add feeds to it from any feed’s Follow menu.</p>
        {/if}
      {/if}
    </section>
  {/if}

  <ActivityList handle={profile.handle} isMe={profile.isMe} />

  {#if profile.notes && (profile.notes.count > 0 || profile.isMe)}
    <section>
      <h2>Notes <span class="n">{profile.notes.count}</span></h2>
      <p class="status">
        {#if profile.isMe}Notes you’ve left on posts. <a href="/notes">Read them all</a>. {#if profile.visibility?.notes === 'public'}Anyone sees them on posts they come across, and in your recent activity above.{:else if profile.visibility?.notes === 'friends'}The people you follow see them on posts they come across, and in your recent activity above.{:else}Only you can see them.{/if} <a href="/settings">Change</a>.
        {:else if profile.people.isFollowing}You see their notes on posts you come across{#if session.user?.notesFrom === 'none'}, once you allow notes in <a href="/settings">Settings</a>{/if}.
        {:else}Follow them to see their notes on posts you come across.{/if}
      </p>
    </section>
  {/if}

  {#if profile.bookmarks}
    <section>
      <h2>Bookmarks <span class="n">{profile.bookmarks.count}</span></h2>
      {#if profile.bookmarks.count === 0}
        <p class="status">{profile.isMe ? 'Nothing saved yet.' : 'No bookmarks to show.'}</p>
      {:else}
        <ul class="list">
          <li><a href="/@{profile.handle}/bookmarks"><div class="meta2"><span class="name">{profile.isMe ? 'Your' : `${profile.displayName ?? profile.handle}’s`} bookmarks</span><span class="desc">{profile.isMe ? 'As others see them' : 'Save any to your own'}</span></div><span class="chev" aria-hidden="true">›</span></a></li>
        </ul>
      {/if}
    </section>
  {/if}

  {#if !session.user}
    <p class="join">Want your own? <a href="/signup?next={encodeURIComponent(page.url.pathname)}">Make an account</a> and start following feeds.</p>
  {/if}
{/if}

<style>
  .who { display: flex; gap: 16px; align-items: flex-start; margin: 8px 0 18px; }
  .names { flex: 1; min-width: 0; }
  h1 { font-family: var(--font-serif); font-size: 28px; margin: 0; line-height: 1.15; overflow-wrap: anywhere; }
  .handle { margin: 2px 0 0; color: var(--text-3); font-size: 15px; }
  .bio { margin: 10px 0 0; color: var(--text); font-size: 15px; white-space: pre-line; }
  .meta { margin: 8px 0 0; font-size: 13px; color: var(--text-3); }
  .meta a { color: var(--accent); font-weight: 600; }
  .btn { flex: none; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 14px; font-weight: 600; color: var(--text-2); }
  .note { margin: 0 0 16px; padding: 10px 14px; border-radius: 12px; background: var(--surface-2); font-size: 14px; color: var(--text-2); }
  .note a { color: var(--accent); font-weight: 600; }
  section { margin-bottom: 22px; }
  h2 { font-size: 16px; margin: 0 0 8px; display: flex; align-items: baseline; gap: 8px; }
  .n { font-size: 13px; color: var(--text-3); font-weight: 400; }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  li a { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-top: 1px solid var(--line); }
  li:first-child a { border-top: 0; }
  .meta2 { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; }
  .tag { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; vertical-align: middle; margin-left: 4px; }
  .desc { font-size: 13px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: 13px; color: var(--text-3); white-space: nowrap; }
  .chev { color: var(--text-3); font-size: 20px; }
  .add { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; border-top: 1px solid var(--line); color: var(--accent); font-weight: 600; font-size: 15px; text-align: left; }
  li:first-child .add { border-top: 0; }
  .plus { font-size: 20px; line-height: 1; width: 14px; }
  .new form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); }
  .new input { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--accent); background: var(--bg); color: var(--text); font-size: 16px; }
  .new form button { padding: 0 16px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .new form button:disabled { opacity: 0.5; }
  .status { color: var(--text-3); font-size: 14px; padding: 8px 0; margin: 0; }
  .empty { text-align: center; padding: 50px 20px; color: var(--text-2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .empty p { margin: 0; }
  .join { text-align: center; color: var(--text-3); font-size: 14px; margin-top: 30px; }
  .join a { color: var(--accent); font-weight: 600; }
</style>
