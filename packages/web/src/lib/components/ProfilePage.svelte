<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { menu } from '$lib/menu';
  import Icon from '$lib/components/Icon.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { api, authApi, profilesApi, profileHref, publicCollectionHref, type Profile, type ProfileCollection, type PublicBookmark, type PublicUser, type ShareLevel } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { hostOf, ugcRel } from '$lib/time';
  import Monogram from '$lib/components/Monogram.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import AvatarCropDialog from '$lib/components/AvatarCropDialog.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';
  import SectionAudience from '$lib/components/SectionAudience.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import Button from '$lib/components/Button.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { removeBookmark, withBookmarkBack } from '$lib/saves';
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
  /**
   * `handle` is whose page this is; left out, it comes from the address
   * (/@handle). `only="collections"` shows just the Collections section under
   * its own title: the screen the Collections tab opens, which is your own
   * list and nothing else of your profile.
   */
  let { handle: whose, only = null }: { handle?: string; only?: 'collections' | null } = $props();
  const handle = $derived(whose ?? page.params.handle ?? '');
  let profile = $state<Profile | null>(null);
  let error = $state<string | null>(null);
  let loadedHandle = $state<string | undefined>(undefined);
  const isMe = $derived(!!profile && !profile.private && profile.isMe);
  $effect(() => { if (isMe) void loadCollections(); });

  $effect(() => {
    if (loadedHandle === handle) return;
    loadedHandle = handle;
    profile = null; error = null;
    activityReady = false; jumped = false;
    profilesApi.get(handle).then((p) => (profile = p)).catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });
  onMount(() => api.event('profile_view', { handle }));

  // A link to a section (#bookmarks, from the note box) can only land once everything above it is drawn: the
  // profile, and the activity list, which loads on its own and would otherwise push the section down after the jump.
  let activityReady = $state(false);
  let jumped = false;
  $effect(() => {
    if (jumped || !profile || (!only && !activityReady)) return;
    jumped = true;
    if (location.hash) void tick().then(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  });

  /**
   * A few recent bookmarks, with the notes on them, shown right on the
   * profile; the rest are one link away. One section with two audiences
   * (issue #84): the server sends only what this viewer may see.
   *
   * On your own profile they're yours to note and remove, as on My Bookmarks
   * (issue #170). One more than is shown is kept in hand, so removing one
   * moves the next up at once; the list is then fetched again to keep one in
   * hand for the next removal.
   */
  const BOOKMARKS_SHOWN = 3;
  let recentBookmarks = $state<PublicBookmark[] | null>(null);
  const shownBookmarks = $derived(recentBookmarks?.slice(0, BOOKMARKS_SHOWN) ?? null);
  let bookmarksFor = $state<string | undefined>(undefined);
  /* Bumped by every change made here, so a fetch that set out before an Undo can't undo it. */
  let bookmarksAsked = 0;
  function loadBookmarks(h: string) {
    const asked = ++bookmarksAsked;
    return profilesApi.bookmarks(h, { limit: BOOKMARKS_SHOWN + 1 }).then((r) => { if (bookmarksFor === h && asked === bookmarksAsked) recentBookmarks = r.bookmarks; });
  }
  $effect(() => {
    if (!profile || profile.private || !profile.bookmarks || profile.bookmarks.count === 0 || bookmarksFor === profile.handle) return;
    const h = profile.handle;
    bookmarksFor = h; recentBookmarks = null;
    loadBookmarks(h).catch(() => (recentBookmarks = []));
  });
  function removeRecent(b: PublicBookmark) {
    if (!profile || profile.private || !profile.bookmarks || !recentBookmarks) return;
    const counts = profile.bookmarks, h = profile.handle, snapshot = recentBookmarks;
    void removeBookmark(b, 'profile', {
      drop: () => {
        bookmarksAsked++;
        recentBookmarks = (recentBookmarks ?? []).filter((x) => x.id !== b.id);
        counts.count--;
      },
      putBack: (id) => {
        // Undo still restores it; the cards only change if this profile is still the one on screen.
        if (bookmarksFor !== h) return;
        bookmarksAsked++;
        recentBookmarks = withBookmarkBack(recentBookmarks ?? [], snapshot, b.id, id);
        counts.count++;
      }
    }).then(() => loadBookmarks(h)).catch((e) => {
      // The cards on screen stay as they are; only the one moving up is missing.
      api.event('profile_bookmarks_refill_failed', { message: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    });
  }

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
   * The people who follow you (issue #191). Only on your own profile, and the
   * API refuses it to anyone else. No count: follower numbers stay off thicket.
   */
  let followers = $state<PublicUser[] | null>(null);
  let followersFor = $state<string | undefined>(undefined);
  $effect(() => {
    if (!profile || profile.private || !profile.isMe || followersFor === profile.handle) return;
    const h = profile.handle;
    followersFor = h; followers = null;
    profilesApi.followers(h).then((r) => { if (followersFor === h) followers = r.users; }).catch(() => (followers = []));
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
   * The Collections page has a filter box (issue #178): it narrows the list to
   * names containing what you type, ignoring capitals. A search wants a flat
   * list of matches, so ones that sit inside another collection show too.
   */
  let colFilter = $state('');
  const colQuery = $derived(colFilter.trim().toLowerCase());
  const colMatches = $derived(colQuery ? cols.filter((c) => c.name.toLowerCase().includes(colQuery)) : []);

  /**
   * The owner edits their public page on the page itself. Everything here only
   * appears when you're looking at your own profile; a visitor sees the plain
   * page. The values come from the signed-in user, so a change shows at once.
   */
  const su = $derived(session.user);
  const collectionsShared = $derived(su?.profileVisibility === 'public' && su.collectionsVisibility !== 'private' ? su.collectionsVisibility : null);
  const AUD: Record<ShareLevel, string> = { private: 'only you', friends: 'people you follow', public: 'anyone' };
  const VISIBILITY = [
    { value: 'public', label: 'Anyone' },
    { value: 'private', label: 'Only me' }
  ];

  // The name/bio/homepage block: one "Edit profile" button turns it into a
  // small form that saves all three together, then settles back into text.
  let editing = $state(false);
  /** The picture is exactly as tall as the name and handle beside it, whatever the fonts and text size. While editing, the form stands in for them, so the picture keeps a fixed size. */
  let namesHeight = $state(0);
  const picSize = $derived(!editing && namesHeight ? namesHeight : 48);
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

<svelte:head><title>{only === 'collections' ? 'Collections' : `@${handle}`} · thicket</title></svelte:head>

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
  {#if !only}
  {#if profile.isMe}
    <p class="ownerbar">This is your <strong>public profile</strong>. Depending on your settings, it's what everyone else sees.</p>
  {/if}
  {@const pr = profile}
  <PageHeader description={pr.bio && !editing ? bio : undefined}>
    {#snippet title()}
    <div class="who">
      {#if pr.isMe}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" bind:this={fileInput} onchange={onFilePicked} hidden />
        <div class="photomenu" bind:this={photoMenuAnchor}>
          <button type="button" class="photobtn" onclick={onPhotoClick} aria-haspopup={pr.avatarUpdatedAt ? 'menu' : undefined} aria-expanded={pr.avatarUpdatedAt ? photoMenuOpen : undefined} aria-label={pr.avatarUpdatedAt ? 'Profile picture options' : 'Add a profile picture'} title={pr.avatarUpdatedAt ? 'Profile picture options' : 'Add a profile picture'}>
            <Avatar handle={pr.handle} name={pr.displayName ?? pr.handle} size={picSize} v={pr.avatarUpdatedAt} />
            <span class="badge" aria-hidden="true"><Icon name="pencil" size={9} /></span>
          </button>
          {#if photoMenuOpen}
            <div class="menupanel" role="menu" aria-label="Profile picture" bind:this={photoMenuPanel} use:menu={{ anchor: photoMenuAnchor, onclose: () => (photoMenuOpen = false) }}>
              <button type="button" class="mi" role="menuitem" onclick={() => { photoMenuOpen = false; pickPhoto(); }}>Change photo</button>
              <button type="button" class="mi danger" role="menuitem" onclick={() => { photoMenuOpen = false; void removePhoto(); }}>Remove photo</button>
            </div>
          {/if}
        </div>
      {:else}
        <Avatar handle={pr.handle} name={pr.displayName ?? pr.handle} size={picSize} v={pr.avatarUpdatedAt} />
      {/if}
      <div class="names" bind:offsetHeight={namesHeight}>
        {#if editing}
          <div class="edit">
            <Field label="Display name">
              {#snippet children({ id, describedBy, invalid })}
                <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={dname} maxlength={60} placeholder={pr!.handle} />
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
          <h1 title={pr.displayName ?? pr.handle}>{pr.displayName ?? pr.handle}</h1>
          <p class="handle">@{pr.handle}{#if pr.homepageUrl}{' '}<Dot />{' '}<a class="site" href={pr.homepageUrl} target="_blank" rel={ugcRel(pr.homepageUrl, 'me')}>{hostOf(pr.homepageUrl)} ↗</a>{/if}</p>
        {/if}
      </div>
    </div>
    {/snippet}
    {#snippet actions()}
      {#if pr.isMe}
        {#if !editing}
            <Button size="sm" onclick={startEdit}><Icon name="pencil" size={16} />Edit profile</Button>
        {/if}
      {:else if session.user}
        <FollowButton small following={pr.people.isFollowing} label="Follow @{pr.handle}" busy={followBusy} onclick={toggleFollow} />
      {:else}
        <FollowButton small label="Follow @{pr.handle}" href="/login?next={encodeURIComponent(page.url.pathname)}" />
      {/if}
    {/snippet}
  </PageHeader>
  {#snippet bio()}<span class="bio">{pr.bio}</span>{/snippet}

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
  {/if}

  {#if profile.collections}
    <section>
      {#if only}
        {@const count = profile.collections.length}
        <PageHeader>
          {#snippet title()}<h1 class="pagetitle">Collections <Badge>{count}</Badge></h1>{/snippet}
          {#snippet description()}Your feeds, grouped your way. {#if !collectionsShared}Only you can see them.{:else}Shown on <a href={profileHref(handle)}>your profile</a>{collectionsShared === 'friends' ? ' to the people you follow' : ''}.{/if}{/snippet}
          {#snippet actions()}{#if isMe}<AddFeedButton via="collections" bottomBarOnly />{/if}{/snippet}
        </PageHeader>
        <Field class="colfilter" label="Filter collections" hideLabel>
          {#snippet children({ id })}
            <Input
              {id}
              variant="search"
              bind:value={colFilter}
              placeholder="Filter collections"
              maxlength="60"
              autocomplete="off"
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') colFilter = ''; }}
            />
          {/snippet}
        </Field>
      {:else}
        <h2>Collections <Badge>{profile.collections.length}</Badge></h2>
      {/if}
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
        {#snippet colRow(c: ProfileCollection, depth: number, withKids = true)}
          <li class:nested={depth > 0}>
            <a href={publicCollectionHref(handle, c.slug)} style:--indent="{depth * 18}px">
              <div class="meta2">
                <span class="name">{c.name}{#if isMe && audienceTag(c.visibility)}<Badge class="aftertext">{audienceTag(c.visibility)}</Badge>{/if}</span>
                {#if c.description}<span class="desc">{c.description}</span>{/if}
              </div>
              {#if isMe && display.fresh && countText(marks.byId[c.id])}<Badge tone="accent">{countText(marks.byId[c.id])} new</Badge>{/if}
              {#if c.copiedByMe}<Badge>Copied</Badge>{/if}
              <span class="count">{c.feedCount} {c.feedCount === 1 ? 'feed' : 'feeds'}</span>
              <span class="chev" aria-hidden="true">›</span>
            </a>
          </li>
          {#if withKids}
            {#each childCols(c.id) as k (k.id)}
              {@render colRow(k, depth + 1)}
            {/each}
          {/if}
        {/snippet}
        <!-- New collection leads the list, so it's never below a long scroll. -->
        <ul class="list">
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
          {#if colQuery}
            {#each colMatches as c (c.id)}
              {@render colRow(c, 0, false)}
            {/each}
          {:else}
            {#each topCols as c (c.id)}
              {@render colRow(c, 0)}
            {/each}
          {/if}
        </ul>
        {#if only}
          <p class="nomatch" aria-live="polite">{#if colQuery && colMatches.length === 0}No collections match “{colFilter.trim()}”{/if}</p>
        {/if}
        {#if profile.collections.length === 0 && profile.isMe}
          <div class="pad"><p class="status">A collection is a handful of feeds you read together. Make one above, then add feeds to it from any feed’s Follow menu.</p></div>
        {/if}
      {/if}
      </div>
    </section>
  {/if}

  {#if !only}
  <ActivityList handle={profile.handle} isMe={profile.isMe} onready={() => (activityReady = true)} />

  {#if profile.bookmarks && (profile.bookmarks.count > 0 || profile.isMe)}
    <!-- The note box's "Change" link lands here, on the notes setting. -->
    <section id="bookmarks">
      <h2>Bookmarks <Badge>{profile.bookmarks.count}</Badge></h2>
      {#if profile.isMe}
        {#if su && su.profileVisibility !== 'private'}
          <!-- Settings, not a bookmark: the same strip as the other sections, on its own, so it doesn't read as one more card below. -->
          <div class="panel">
            <div class="cardhead">
              <span class="ctrl-label">Who sees your bookmarks</span>
              <SectionAudience level={su.bookmarksVisibility} label="your bookmarks" onchange={(l) => save({ bookmarksVisibility: l }, `Bookmarks: ${AUD[l]}`)} />
            </div>
            <div class="cardhead">
              <span class="ctrl-label">Who sees your notes</span>
              <SectionAudience level={su.notesVisibility} label="your notes" onchange={(l) => save({ notesVisibility: l }, `Notes: ${AUD[l]}`)} />
            </div>
          </div>
        {/if}
      {:else if profile.bookmarks.notes !== null && session.user && profile.people.isFollowing}
        <p class="status">You also see their notes on posts you come across{#if session.user.notesFrom === 'none'}, once you allow notes in <a href="/settings">Settings</a>{/if}.</p>
      {:else if profile.bookmarks.notes !== null && session.user?.notesFrom === 'following'}
        <p class="status">Follow them to also see their notes on posts you come across.</p>
      {/if}
      {#if profile.bookmarks.count === 0}
        <p class="status">Press the bookmark on any post to save it, or the note button to write down what you thought of it.</p>
      {:else if shownBookmarks === null}
        <p class="status">Loading…</p>
      {:else if shownBookmarks.length === 0}
        <p class="status">No bookmarks to show.</p>
      {:else}
        <ul class="saves">
          {#each shownBookmarks as b (b.id)}
            <BookmarkCard {b} mine={isMe} author={profile} onopen={() => api.event('bookmark_opened', { via: 'profile' })}
              action={isMe ? { kind: 'remove', on: true, label: b.note ? 'Remove bookmark and note' : 'Remove bookmark', run: () => removeRecent(b) } : undefined} />
          {/each}
        </ul>
        {#if profile.bookmarks.count > shownBookmarks.length}
          <!-- Your own goes to My Bookmarks, where search and filters are; a visitor gets the public list. -->
          <a class="all tap" href={isMe ? '/bookmarks' : `/@${profile.handle}/bookmarks`}>All {profile.bookmarks.count} bookmarks <span aria-hidden="true">›</span></a>
        {/if}
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
          {@render people(following)}
        {/if}
      </div>
    </section>
  {/if}

  {#if profile.isMe}
    <section>
      <h2>Followers <Badge>Only you</Badge></h2>
      <div class="card">
        <div class="pad"><p class="status">Only you can see who follows you. Following you doesn’t show them anything you haven’t shared with everyone.</p></div>
        {#if followers === null}
          <div class="pad"><p class="status">Loading…</p></div>
        {:else if followers.length === 0}
          <div class="pad"><p class="status">No one is following you yet.</p></div>
        {:else}
          {@render people(followers)}
        {/if}
      </div>
    </section>
  {/if}

  {#snippet people(list: PublicUser[])}
    <ul class="list">
      {#each list as p (p.handle)}
        <li><a href="/@{p.handle}">
          <Avatar handle={p.handle} name={p.displayName ?? p.handle} size={34} v={p.avatarUpdatedAt} />
          <div class="meta2"><span class="name">{p.displayName ?? p.handle}</span><span class="desc">@{p.handle}</span></div>
          <span class="chev" aria-hidden="true">›</span>
        </a></li>
      {/each}
    </ul>
  {/snippet}

  {/if}

  {#if !session.user}
    <p class="join">Want your own? <a href="/signup?next={encodeURIComponent(page.url.pathname)}">Sign up</a> and start following feeds.</p>
  {/if}
{/if}

<style>
  /* The Collections screen's own title, in the place a page title sits everywhere else. */
  .pagetitle { display: flex; align-items: center; gap: var(--space-2); font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.15; margin: 0; }
  /* More room under the picture and name, before the description. */
  /* A bio keeps the line breaks its person typed. */
  .bio { white-space: pre-line; }
  /* Your own picture is a button: a small pencil badge at its corner says it can be changed. Tapping opens Change / Remove photo. */
  .photomenu { position: relative; flex: none; }
  .photobtn { position: relative; display: block; padding: 0; border-radius: var(--radius-avatar); line-height: 0; }
  .photobtn:hover { opacity: 0.92; }
  .photobtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* The badge hangs 3px off the picture's corner: an optical overlap, not a spacing step. */
  .badge { position: absolute; right: -3px; bottom: -3px; display: grid; place-items: center; width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--accent); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--bg); }
  .menupanel { position: absolute; top: calc(100% + var(--space-2)); left: 0; z-index: 60; min-width: 200px; max-width: calc(100vw - 16px); background: var(--surface); border-radius: var(--radius-md); padding: var(--space-2); box-shadow: var(--shadow-menu); display: flex; flex-direction: column; }
  .mi { display: block; width: 100%; text-align: left; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text); }
  .mi:hover { background: var(--surface-2); }
  .mi.danger { color: var(--danger); }
  .who { display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
  .names { flex: 1; min-width: 0; }
  /* The page header stays on one line, always; a name too long to fit ends in an ellipsis (full name on hover). */
  /* The name and handle are trimmed to their letters, top of the capitals to the baseline, so the picture beside them can match what you see: the name from the top of its capitals, the handle down to the bottom of letters like y and p. */
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 -0.2em; padding-bottom: 0.2em; line-height: 1.15; text-box: trim-both cap alphabetic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .handle { margin: var(--space-2) 0 0; line-height: 1.3; text-box: trim-both cap text; color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); }
  .site { color: var(--accent); font-weight: 600; }
  /* Edit: a quiet pencil, the same at every width. */

  /* Owner only: a muted one-line reminder in a soft box at the very top of the page. */
  .ownerbar { margin: 0 0 var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); background: var(--surface-2); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); text-align: center; }

  /* Every section's content sits in a card — the same surface + shadow the
     lists always used. The audience control rides at the top in a header bar. */
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .panel { background: var(--panel); border-radius: var(--radius); padding: var(--space-2) 0; }
  .panel .cardhead { background: none; }
  .pad { padding: var(--space-4); }
  /* A tinted control strip, not a list row: the background sets it apart from
     the white rows below, and the label sits right beside its buttons. */
  .cardhead { display: flex; align-items: center; gap: var(--space-2) var(--space-3); flex-wrap: wrap; padding: var(--space-2) var(--space-4); background: var(--panel); }
  .ctrl-label { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); line-height: 1.2; }
  /* At least 320px so the options aren't cramped, wider when larger text needs
     it, and never wider than the strip. A fixed 320px made the control fall
     back to its dropdown at larger text sizes with empty room beside it. */
  .cardhead :global(.cg) { flex: none; width: fit-content; min-width: min(320px, 100%); max-width: 100%; }

  /* Visibility: the label and its explanation on the left, the switch on the right. */
  .visrow { display: flex; align-items: flex-start; gap: var(--space-3); flex-wrap: wrap; }
  .vislabel { flex: 1; min-width: 12ch; }
  .publabel { display: block; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); line-height: 1.25; }
  /* 2px is an optical nudge under the label, not a spacing step. */
  .hint { margin: 2px 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }

  /* The public/private switch sits at the right-hand end of its row. */
  .visrow :global(.vis) { margin-left: auto; flex: none; }

  /* Editing name, bio and homepage right in the header. */
  .edit { display: flex; flex-direction: column; gap: var(--space-5); }
  .editrow { display: flex; justify-content: flex-end; gap: var(--space-2); }

  section { margin-bottom: var(--space-5); }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0 0 var(--space-3); display: flex; align-items: baseline; gap: var(--space-2); line-height: 1.25; }
  .list { list-style: none; margin: 0; padding: 0; }
  li a { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + var(--indent, 0px)); border-top: 1px solid var(--line); }
  /* A sub-collection is indented and its name sits quieter than its parent's, so the tree reads at a glance. */
  .nested .name { font-weight: 500; color: var(--text-2); }
  li:first-child a { border-top: 0; }
  .meta2 { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A pill riding after a name needs its own gap: the words beside it are text, not a flex row. */
  .name :global(.aftertext) { margin-left: var(--space-2); }
  .desc { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
  .add { display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); color: var(--accent); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); text-align: left; }
  li:first-child .add, li:first-child form { border-top: 0; }
  .plus { font-size: calc(var(--text-xl) * var(--size-app)); line-height: 1; width: 14px; }
  .new form { display: flex; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .new form :global(.grow) { flex: 1; min-width: 0; }
  /* The Collections page's filter sits between the title and the card, like the Bookmarks search. */
  section > :global(.colfilter) { margin: 0 0 var(--space-3); }
  .nomatch { margin: 0; padding: 0 var(--space-4); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .nomatch:not(:empty) { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-2) 0; margin: 0; }
  .status a { color: var(--accent); font-weight: 600; }
  .saves { display: flex; flex-direction: column; gap: var(--space-3); margin: var(--space-3) 0 0; padding: 0; list-style: none; }
  .all { display: block; width: fit-content; margin: var(--space-3) 0 0 auto; color: var(--accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-4)) var(--space-5); color: var(--text-2); display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
  .empty p { margin: 0; }
  .join { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); margin-top: var(--space-6); }
  .join a { color: var(--accent); font-weight: 600; }
</style>
