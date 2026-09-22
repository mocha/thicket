<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, authApi, profilesApi, publicCollectionHref, type Profile, type ProfileCollection, type PublicBookmark, type PublicUser, type RiverItem, type ShareLevel } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { hostOf } from '$lib/time';
  import Monogram from '$lib/components/Monogram.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import AvatarCropDialog from '$lib/components/AvatarCropDialog.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';
  import SectionAudience from '$lib/components/SectionAudience.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import NoteCard from '$lib/components/NoteCard.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import Button from '$lib/components/Button.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { goto } from '$app/navigation';
  import { collectionsApi, collectionHref } from '$lib/api';
  import { audienceTag } from '$lib/visibility';
  import { loadCollections } from '$lib/collections.svelte';
  import { marks, countText } from '$lib/marks.svelte';
  import { display } from '$lib/display.svelte';

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

  /** The newest few notes, shown right on the profile; the rest are one link away. */
  const NOTES_SHOWN = 3;
  let recentNotes = $state<RiverItem[] | null>(null);
  let notesFor = $state<string | undefined>(undefined);
  $effect(() => {
    if (!profile || profile.private || !profile.notes || notesFor === profile.handle) return;
    const h = profile.handle;
    notesFor = h; recentNotes = null;
    profilesApi.notes(h, { limit: NOTES_SHOWN }).then((r) => { if (notesFor === h) recentNotes = r.items; }).catch(() => (recentNotes = []));
  });
  /** On my own profile, a note I delete from its card takes the card with it. */
  const shownNotes = $derived((recentNotes ?? []).filter((i) => !isMe || i.myNote));

  /** A few recent bookmarks, shown right on the profile; the rest are one link away. */
  const BOOKMARKS_SHOWN = 3;
  let recentBookmarks = $state<PublicBookmark[] | null>(null);
  let bookmarksFor = $state<string | undefined>(undefined);
  $effect(() => {
    if (!profile || profile.private || !profile.bookmarks || profile.bookmarks.count === 0 || bookmarksFor === profile.handle) return;
    const h = profile.handle;
    bookmarksFor = h; recentBookmarks = null;
    profilesApi.bookmarks(h, null, BOOKMARKS_SHOWN).then((r) => { if (bookmarksFor === h) recentBookmarks = r.bookmarks; }).catch(() => (recentBookmarks = []));
  });

  /** The people this person follows — their own section. */
  let following = $state<PublicUser[] | null>(null);
  let followingFor = $state<string | undefined>(undefined);
  $effect(() => {
    if (!profile || profile.private || followingFor === profile.handle) return;
    const h = profile.handle;
    followingFor = h; following = null;
    profilesApi.following(h).then((r) => { if (followingFor === h) following = r.users; }).catch(() => (following = []));
  });

  /**
   * Collections arrive flat with parent pointers, and are shown as the tree
   * they are — the same shape the sidebar shows. Top level is anything whose
   * parent isn't in the list: the root, which is nobody's page, and also a
   * collection whose parent this reader may not see, which keeps that child
   * reachable instead of hiding it under something absent.
   */
  const cols = $derived(profile && !profile.private ? profile.collections ?? [] : []);
  const colIds = $derived(new Set(cols.map((c) => c.id)));
  const topCols = $derived(cols.filter((c) => c.parentId === null || !colIds.has(c.parentId)));
  const childCols = (id: number) => cols.filter((c) => c.parentId === id);

  /**
   * The owner edits their public page on the page itself. Everything here only
   * appears when you're looking at your own profile; a visitor sees the plain
   * page. The values come from the signed-in user, so a change shows at once.
   */
  const su = $derived(session.user);
  const AUD: Record<ShareLevel, string> = { private: 'only you', friends: 'people you follow', public: 'anyone' };
  const VISIBILITY = [
    { value: 'public', label: 'Anyone' },
    { value: 'private', label: 'Only me' }
  ];

  // The name/bio/homepage block: one "Edit profile" button turns it into a
  // small form that saves all three together, then settles back into text.
  let editing = $state(false);
  let dname = $state('');
  let dbio = $state('');
  let dhome = $state('');
  let savingProfile = $state(false);
  function startEdit() {
    const u = session.user;
    if (!u) return;
    dname = u.displayName ?? '';
    dbio = u.bio ?? '';
    dhome = u.homepageUrl ?? '';
    editing = true;
  }
  async function saveEdit() {
    if (savingProfile) return;
    savingProfile = true;
    try {
      const updated = await authApi.update({ displayName: dname || null, bio: dbio || null, homepageUrl: dhome || null });
      setMe(updated);
      if (profile && !profile.private) {
        profile.displayName = updated.displayName;
        profile.bio = updated.bio;
        profile.homepageUrl = updated.homepageUrl;
      }
      dhome = updated.homepageUrl ?? '';
      api.event('profile_updated');
      editing = false;
      showToast('Profile saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      savingProfile = false;
    }
  }

  // Profile picture: pick a file, frame it in the cropper, upload. On success
  // both the signed-in user and this page's copy learn the new timestamp, so
  // the new picture shows everywhere at once.
  let fileInput = $state<HTMLInputElement | null>(null);
  let pendingFile = $state<File | null>(null);
  let removingAvatar = $state(false);
  function pickPhoto() { fileInput?.click(); }

  // Tapping your avatar. With a photo, both actions (change, remove) live in a
  // small menu hung off the avatar; with no photo there's only one thing to do,
  // so we skip the menu and open the file picker straight away.
  let photoMenuOpen = $state(false);
  let photoMenuAnchor = $state<HTMLElement | null>(null);
  let photoMenuPanel = $state<HTMLElement | null>(null);
  function onPhotoClick() {
    if (profile && !profile.private && profile.avatarUpdatedAt) photoMenuOpen = !photoMenuOpen;
    else pickPhoto();
  }
  $effect(() => {
    if (!photoMenuOpen) return;
    const onDoc = (e: MouseEvent) => { if (!photoMenuPanel?.contains(e.target as Node) && !photoMenuAnchor?.contains(e.target as Node)) photoMenuOpen = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') photoMenuOpen = false; };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  });
  function onFilePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = ''; // let the same file be picked again after a cancel
    if (f) pendingFile = f;
  }
  function onAvatarSaved(avatarUpdatedAt: string) {
    if (session.user) setMe({ ...session.user, avatarUpdatedAt });
    if (profile && !profile.private) profile.avatarUpdatedAt = avatarUpdatedAt;
    pendingFile = null;
    api.event('avatar_changed', { action: 'set' });
    showToast('Profile picture updated');
  }
  async function removePhoto() {
    if (removingAvatar) return;
    removingAvatar = true;
    try {
      await authApi.removeAvatar();
      if (session.user) setMe({ ...session.user, avatarUpdatedAt: null });
      if (profile && !profile.private) profile.avatarUpdatedAt = null;
      api.event('avatar_changed', { action: 'remove' });
      showToast('Profile picture removed');
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      removingAvatar = false;
    }
  }

  // The public/private switch and each section's "who sees this": every one
  // saves the moment it's picked, the way the old settings toggles did.
  async function save(patch: Parameters<typeof authApi.update>[0], label: string) {
    try {
      setMe(await authApi.update(patch));
      api.event('settings_changed', { keys: Object.keys(patch) });
      showToast(label);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }
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
  {#if profile.isMe}
    <p class="ownerbar">This is your <strong>public profile</strong>. Depending on your settings, it's what everyone else sees.</p>
  {/if}
  <header class="who">
    {#if profile.isMe}
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" bind:this={fileInput} onchange={onFilePicked} hidden />
      <div class="photomenu" bind:this={photoMenuAnchor}>
        <button type="button" class="photobtn" onclick={onPhotoClick} aria-haspopup={profile.avatarUpdatedAt ? 'menu' : undefined} aria-expanded={profile.avatarUpdatedAt ? photoMenuOpen : undefined} aria-label={profile.avatarUpdatedAt ? 'Profile picture options' : 'Add a profile picture'} title={profile.avatarUpdatedAt ? 'Profile picture options' : 'Add a profile picture'}>
          <Avatar handle={profile.handle} name={profile.displayName ?? profile.handle} size={56} v={profile.avatarUpdatedAt} />
          <span class="camera" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
          </span>
        </button>
        {#if photoMenuOpen}
          <div class="menupanel" role="menu" aria-label="Profile picture" bind:this={photoMenuPanel}>
            <button type="button" class="mi" role="menuitem" onclick={() => { photoMenuOpen = false; pickPhoto(); }}>Change photo</button>
            {#if profile.avatarUpdatedAt}
              <button type="button" class="mi danger" role="menuitem" onclick={() => { photoMenuOpen = false; void removePhoto(); }}>Remove photo</button>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <Avatar handle={profile.handle} name={profile.displayName ?? profile.handle} size={56} v={profile.avatarUpdatedAt} />
    {/if}
    <div class="names">
      {#if editing}
        <div class="edit">
          <Field label="Display name">
            {#snippet children({ id, describedBy, invalid })}
              <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={dname} maxlength={60} placeholder={profile!.handle} />
            {/snippet}
          </Field>
          <Field label="About you">
            {#snippet children({ id, describedBy, invalid })}
              <Textarea {id} aria-describedby={describedBy} {invalid} inset bind:value={dbio} rows={3} maxlength={500} placeholder="A line or two. What you read, what you make." />
            {/snippet}
          </Field>
          <Field label="Homepage">
            {#snippet children({ id, describedBy, invalid })}
              <Input {id} aria-describedby={describedBy} {invalid} inset type="url" inputmode="url" autocomplete="url" bind:value={dhome} placeholder="https://" />
            {/snippet}
          </Field>
          <div class="editrow">
            <Button onclick={() => (editing = false)} disabled={savingProfile}>Cancel</Button>
            <Button variant="primary" onclick={saveEdit} disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      {:else}
        <h1 title={profile.displayName ?? profile.handle}>{profile.displayName ?? profile.handle}</h1>
        <p class="handle">@{profile.handle}{#if profile.homepageUrl}{' · '}<a class="site" href={profile.homepageUrl} target="_blank" rel="noopener me">{hostOf(profile.homepageUrl)} ↗</a>{/if}</p>
        {#if profile.bio}<p class="bio">{profile.bio}</p>{/if}
      {/if}
    </div>
    {#if profile.isMe}
      {#if !editing}
        <div class="ownerctrls">
          <IconButton icon="pencil" variant="bordered" size="lg" onclick={startEdit} label="Edit profile" title="Edit profile" />
        </div>
      {/if}
    {:else if session.user}
      <Button onclick={toggleFollow} disabled={followBusy} aria-pressed={profile.people.isFollowing} style="flex: none">{profile.people.isFollowing ? 'Following' : 'Follow'}</Button>
    {:else}
      <Button href="/login?next={encodeURIComponent(page.url.pathname)}" style="flex: none">Follow</Button>
    {/if}
  </header>

  {#if profile.isMe && pendingFile}
    <AvatarCropDialog file={pendingFile} onclose={() => (pendingFile = null)} onsaved={onAvatarSaved} />
  {/if}

  {#if profile.isMe && su}
    <section>
      <h2>Profile visibility</h2>
      <div class="card">
        <div class="pad visrow">
          <div class="vislabel">
            <span class="publabel">Who can see this page</span>
            <p class="hint">{su.profileVisibility === 'private' ? 'Hidden so only you can see this page. You still count toward feed follower numbers, but no one can tell it’s you.' : 'Anyone can open it and see the parts you share below.'}</p>
          </div>
          <ChoiceGroup
            class="vis"
            options={VISIBILITY}
            value={su.profileVisibility}
            label="Who can see this page"
            onchange={(v) => save({ profileVisibility: v as 'public' | 'private' }, v === 'public' ? 'Profile is public' : 'Profile is private')}
          />
        </div>
      </div>
    </section>
  {/if}

  {#if profile.collections}
    <section>
      <h2>Collections <Badge>{profile.collections.length}</Badge></h2>
      <div class="card">
        {#if profile.isMe && su && su.profileVisibility !== 'private'}
          <div class="cardhead">
            <span class="ctrl-label">Who sees this</span>
            <SectionAudience level={su.collectionsVisibility} label="your collections" onchange={(l) => save({ collectionsVisibility: l }, `Collections: ${AUD[l]}`)} />
          </div>
        {/if}
        {#if profile.collections.length === 0 && !profile.isMe}
        <div class="pad"><p class="status">No collections to show.</p></div>
      {:else}
        {#snippet colRow(c: ProfileCollection, depth: number)}
          <li class:nested={depth > 0}>
            <a href={publicCollectionHref(handle, c.slug)} style:--indent="{depth * 18}px">
              <div class="meta2">
                <span class="name">{c.name}{#if isMe && audienceTag(c.visibility)}<Badge class="aftertext">{audienceTag(c.visibility)}</Badge>{/if}</span>
                {#if c.description}<span class="desc">{c.description}</span>{/if}
              </div>
              {#if isMe && display.fresh && countText(marks.byId[c.id])}<Badge tone="accent">{countText(marks.byId[c.id])} new</Badge>{/if}
              <span class="count">{c.feedCount} {c.feedCount === 1 ? 'feed' : 'feeds'}</span>
              <span class="chev" aria-hidden="true">›</span>
            </a>
          </li>
          {#each childCols(c.id) as k (k.id)}
            {@render colRow(k, depth + 1)}
          {/each}
        {/snippet}
        <ul class="list">
          {#each topCols as c (c.id)}
            {@render colRow(c, 0)}
          {/each}
          {#if profile.isMe}
            <li class="new">
              {#if creating}
                <form onsubmit={(e) => { e.preventDefault(); void createCollection(); }}>
                  <Field label="New collection name" hideLabel class="grow">
                    {#snippet children({ id })}
                      <Input
                        {id}
                        bind:element={newInput}
                        variant="create"
                        inset
                        bind:value={newName}
                        placeholder="Name it, e.g. News"
                        maxlength="60"
                        disabled={newBusy}
                        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') creating = false; }}
                      >
                        {#snippet trailing()}
                          <Button type="submit" variant="primary" disabled={newBusy || !newName.trim()}>{newBusy ? 'Creating…' : 'Create'}</Button>
                        {/snippet}
                      </Input>
                    {/snippet}
                  </Field>
                </form>
              {:else}
                <button class="add" onclick={() => { creating = true; queueMicrotask(() => newInput?.focus()); }}><span class="plus" aria-hidden="true">+</span> New collection</button>
              {/if}
            </li>
          {/if}
        </ul>
        {#if profile.collections.length === 0 && profile.isMe}
          <div class="pad"><p class="status">A collection is a handful of feeds you read together. Make one above, then add feeds to it from any feed’s Follow menu.</p></div>
        {/if}
      {/if}
      </div>
    </section>
  {/if}

  <ActivityList handle={profile.handle} isMe={profile.isMe} />

  {#if profile.notes && (profile.notes.count > 0 || profile.isMe)}
    <section>
      <h2>Notes <Badge>{profile.notes.count}</Badge></h2>
      {#if profile.isMe}
        {#if su && su.profileVisibility !== 'private'}
          <div class="card">
            <div class="cardhead">
              <span class="ctrl-label">Who sees this</span>
              <SectionAudience level={su.notesVisibility} label="your notes" onchange={(l) => save({ notesVisibility: l }, `Notes: ${AUD[l]}`)} />
            </div>
            <div class="pad"><p class="status">
              {#if su.notesVisibility === 'public'}Anyone can see your notes, whether they are signed in or not. They display on your profile and under the post each note is about.{:else if su.notesVisibility === 'friends'}Only people you follow can see your notes. They display on your profile and under the post each note is about.{:else}Only you can see your notes.{/if}
            </p></div>
          </div>
        {/if}
      {:else if session.user && profile.people.isFollowing}
        <p class="status">You also see their notes on posts you come across{#if session.user.notesFrom === 'none'}, once you allow notes in <a href="/settings">Settings</a>{/if}.</p>
      {:else if session.user?.notesFrom === 'following'}
        <p class="status">Follow them to also see their notes on posts you come across.</p>
      {/if}
      {#if recentNotes === null}
        <p class="status">Loading…</p>
      {:else if shownNotes.length === 0}
        <p class="status">{profile.isMe ? 'Press the note icon on any post to write down what you thought of it.' : 'No notes to show.'}</p>
      {:else}
        <ul class="notes">
          {#each shownNotes as item (item.id)}
            <NoteCard {item} />
          {/each}
        </ul>
        {#if profile.notes.count > shownNotes.length}
          <a class="all" href="/@{profile.handle}/notes">All {profile.notes.count} notes <span aria-hidden="true">›</span></a>
        {/if}
      {/if}
    </section>
  {/if}

  {#if profile.bookmarks}
    <section>
      <h2>Bookmarks <Badge>{profile.bookmarks.count}</Badge></h2>
      <div class="card">
        {#if profile.isMe && su && su.profileVisibility !== 'private'}
          <div class="cardhead">
            <span class="ctrl-label">Who sees this</span>
            <SectionAudience level={su.bookmarksVisibility} label="your bookmarks" onchange={(l) => save({ bookmarksVisibility: l }, `Bookmarks: ${AUD[l]}`)} />
          </div>
        {/if}
        {#if profile.bookmarks.count === 0}
          <div class="pad"><p class="status">{profile.isMe ? 'Nothing saved yet.' : 'No bookmarks to show.'}</p></div>
        {:else if recentBookmarks === null}
          <div class="pad"><p class="status">Loading…</p></div>
        {:else}
          <ul class="list">
            {#each recentBookmarks as b (b.id)}
              <li><a href={b.url} target="_blank" rel="noopener">
                <div class="meta2"><span class="name">{b.title ?? b.url}</span><span class="desc">{b.siteTitle ?? hostOf(b.url)}</span></div>
                <span class="chev" aria-hidden="true">↗</span>
              </a></li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if recentBookmarks && recentBookmarks.length > 0 && profile.bookmarks.count > recentBookmarks.length}
        <a class="all" href="/@{profile.handle}/bookmarks">All {profile.bookmarks.count} bookmarks <span aria-hidden="true">›</span></a>
      {/if}
    </section>
  {/if}

  {#if profile.isMe || (following !== null && following.length > 0)}
    <section>
      <h2>Following {#if following}<Badge>{following.length}</Badge>{/if}</h2>
      <div class="card">
        {#if following === null}
          <div class="pad"><p class="status">Loading…</p></div>
        {:else if following.length === 0}
          <div class="pad"><p class="status">{profile.isMe ? 'You aren’t following anyone yet. Open someone’s profile and press Follow.' : 'Not following anyone yet.'}</p></div>
        {:else}
          <ul class="list">
            {#each following as p (p.handle)}
              <li><a href="/@{p.handle}">
                <Avatar handle={p.handle} name={p.displayName ?? p.handle} size={34} v={p.avatarUpdatedAt} />
                <div class="meta2"><span class="name">{p.displayName ?? p.handle}</span><span class="desc">@{p.handle}</span></div>
                <span class="chev" aria-hidden="true">›</span>
              </a></li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  {/if}

  {#if !session.user}
    <p class="join">Want your own? <a href="/signup?next={encodeURIComponent(page.url.pathname)}">Make an account</a> and start following feeds.</p>
  {/if}
{/if}

<style>
  .who { display: flex; gap: 16px; align-items: flex-start; margin: 8px 0 18px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
  .names { flex: 1; min-width: 0; }
  /* The page header stays on one line, always; a name too long to fit ends in an ellipsis (full name on hover). */
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .handle { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-base) * var(--size-app)); }
  .site { color: var(--accent); font-weight: 600; }
  .bio { margin: 10px 0 0; color: var(--text); font-size: calc(var(--text-base) * var(--size-app)); white-space: pre-line; }
  /* The avatar as a button: a camera badge in the corner says it's changeable. */
  .photobtn { flex: none; position: relative; padding: 0; border-radius: var(--radius-avatar); line-height: 0; }
  .photobtn .camera { position: absolute; right: -3px; bottom: -3px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: var(--radius-pill); background: var(--accent); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--surface); }
  .photobtn:hover { opacity: 0.92; }
  .photobtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ownerctrls { flex: none; display: flex; align-items: center; gap: 8px; }
  /* The avatar's tap menu: hangs off the avatar, opening down and to the left. */
  .photomenu { position: relative; flex: none; }
  .menupanel { position: absolute; top: calc(100% + 8px); left: 0; z-index: 60; min-width: 200px; max-width: calc(100vw - 16px); background: var(--surface); border-radius: var(--radius-md); padding: 6px; box-shadow: var(--shadow-menu); display: flex; flex-direction: column; }
  .mi { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: var(--radius-sm); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text); }
  .mi:hover { background: var(--surface-2); }
  .mi.danger { color: var(--danger); }
  /* Edit: a quiet pencil, the same at every width. */

  /* Owner only: a muted one-line reminder in a soft box at the very top of the page. */
  .ownerbar { margin: 0 0 18px; padding: 12px 16px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); text-align: center; }

  /* Every section's content sits in a card — the same surface + shadow the
     lists always used. The audience control rides at the top in a header bar. */
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .pad { padding: 16px; }
  /* A tinted control strip, not a list row: the background sets it apart from
     the white rows below, and the label sits right beside its buttons. */
  .cardhead { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; padding: 10px 14px; background: var(--surface-2); }
  .ctrl-label { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); line-height: 1.2; }
  .cardhead :global(.cg) { flex: none; width: min(320px, 100%); }

  /* Visibility: the label and its explanation on the left, the switch on the right. */
  .visrow { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
  .vislabel { flex: 1; min-width: 12ch; }
  .publabel { display: block; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); line-height: 1.25; }
  .hint { margin: 2px 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }

  /* The public/private switch sits at the right-hand end of its row. */
  .visrow :global(.vis) { margin-left: auto; flex: none; }

  /* Editing name, bio and homepage right in the header. */
  .edit { display: flex; flex-direction: column; gap: 10px; }
  .editrow { display: flex; justify-content: flex-end; gap: 8px; }

  section { margin-bottom: 22px; }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0 0 12px; display: flex; align-items: baseline; gap: 8px; line-height: 1.25; }
  .list { list-style: none; margin: 0; padding: 0; }
  li a { display: flex; align-items: center; gap: 12px; padding: 14px 16px 14px calc(16px + var(--indent, 0px)); border-top: 1px solid var(--line); }
  /* A sub-collection is indented and its name sits quieter than its parent's, so the tree reads at a glance. */
  .nested .name { font-weight: 500; color: var(--text-2); }
  li:first-child a { border-top: 0; }
  .meta2 { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A pill riding after a name needs its own gap: the words beside it are text, not a flex row. */
  .name :global(.aftertext) { margin-left: var(--space-2); }
  .desc { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); white-space: nowrap; }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
  .add { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; border-top: 1px solid var(--line); color: var(--accent); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); text-align: left; }
  li:first-child .add { border-top: 0; }
  .plus { font-size: calc(var(--text-xl) * var(--size-app)); line-height: 1; width: 14px; }
  .new form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); }
  .new form :global(.grow) { flex: 1; min-width: 0; }
  .status { color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); padding: 8px 0; margin: 0; }
  .status a { color: var(--accent); font-weight: 600; }
  .notes { display: flex; flex-direction: column; gap: var(--space-3); margin: 4px 0 0; padding: 0; list-style: none; }
  .all { display: block; width: fit-content; margin: 12px 0 0 auto; color: var(--accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .empty { text-align: center; padding: 50px 20px; color: var(--text-2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .empty p { margin: 0; }
  .join { text-align: center; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); margin-top: 30px; }
  .join a { color: var(--accent); font-weight: 600; }
</style>
