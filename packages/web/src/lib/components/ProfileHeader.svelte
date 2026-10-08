<script lang="ts">
  /**
   * The top of a person's profile, the same on every tab: picture, name,
   * handle, how many people they follow (and, for the owner alone, how many
   * follow them), bio, and Edit profile or Follow. The owner edits their name,
   * bio, homepage, and picture right here.
   */
  import Dot from './Dot.svelte';
  import PageHeader from './PageHeader.svelte';
  import Icon from './Icon.svelte';
  import FollowButton from './FollowButton.svelte';
  import Avatar from './Avatar.svelte';
  import AvatarCropDialog from './AvatarCropDialog.svelte';
  import PeopleSheet from './PeopleSheet.svelte';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Textarea from './Textarea.svelte';
  import { menu } from '$lib/menu';
  import { page } from '$app/state';
  import { api, authApi, profilesApi } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { hostOf, ugcRel } from '$lib/time';
  import { showToast } from '$lib/toast.svelte';
  import type { LoadedProfile } from '$lib/profile.svelte';

  let { profile }: { profile: LoadedProfile } = $props();

  /** The following or followers list, open in a Sheet. */
  let people = $state<'following' | 'followers' | null>(null);

  /** Follow a person: one-directional, nothing is sent to them. Their notes start showing on your posts (if you let them). */
  let followBusy = $state(false);
  async function toggleFollow() {
    if (followBusy) return;
    followBusy = true;
    const was = profile.people.isFollowing;
    try {
      const r = was ? await profilesApi.unfollow(profile.handle) : await profilesApi.follow(profile.handle);
      profile.people = { ...profile.people, isFollowing: r.isFollowing };
      api.event(r.isFollowing ? 'user_followed' : 'user_unfollowed', { handle: profile.handle });
      showToast(r.isFollowing ? `Following ${profile.displayName ?? '@' + profile.handle}. Their notes will show on posts you both see.` : `Unfollowed ${profile.displayName ?? '@' + profile.handle}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      followBusy = false;
    }
  }

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
      {
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
    if (profile.avatarUpdatedAt) photoMenuOpen = !photoMenuOpen;
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
    profile.avatarUpdatedAt = avatarUpdatedAt;
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
      profile.avatarUpdatedAt = null;
      api.event('avatar_changed', { action: 'remove' });
      showToast('Profile picture removed');
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      removingAvatar = false;
    }
  }
</script>

<PageHeader description={profile.bio && !editing ? bio : undefined}>
  {#snippet title()}
  <div class="who">
    {#if profile.isMe}
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" bind:this={fileInput} onchange={onFilePicked} hidden />
      <div class="photomenu" bind:this={photoMenuAnchor}>
        <button type="button" class="photobtn" onclick={onPhotoClick} aria-haspopup={profile.avatarUpdatedAt ? 'menu' : undefined} aria-expanded={profile.avatarUpdatedAt ? photoMenuOpen : undefined} aria-label={profile.avatarUpdatedAt ? 'Profile picture options' : 'Add a profile picture'} title={profile.avatarUpdatedAt ? 'Profile picture options' : 'Add a profile picture'}>
          <Avatar handle={profile.handle} name={profile.displayName ?? profile.handle} size={picSize} v={profile.avatarUpdatedAt} />
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
      <Avatar handle={profile.handle} name={profile.displayName ?? profile.handle} size={picSize} v={profile.avatarUpdatedAt} />
    {/if}
    <div class="names" bind:offsetHeight={namesHeight}>
      {#if editing}
        <div class="edit">
          <Field label="Display name">
            {#snippet children({ id, describedBy, invalid })}
              <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={dname} maxlength={60} placeholder={profile.handle} />
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
        <p class="handle">@{profile.handle}{' '}<Dot />{' '}<button type="button" class="people" aria-haspopup="dialog" onclick={() => (people = 'following')}><strong>{profile.people.follows}</strong> following</button>{#if profile.people.followers !== null}{' '}<Dot />{' '}<button type="button" class="people" aria-haspopup="dialog" onclick={() => (people = 'followers')}><strong>{profile.people.followers}</strong> {profile.people.followers === 1 ? 'follower' : 'followers'}</button>{/if}{#if profile.homepageUrl}{' '}<Dot />{' '}<a class="site" href={profile.homepageUrl} target="_blank" rel={ugcRel(profile.homepageUrl, 'me')}>{hostOf(profile.homepageUrl)} ↗</a>{/if}</p>
      {/if}
    </div>
  </div>
  {/snippet}
  {#snippet actions()}
    {#if profile.isMe}
      {#if !editing}
          <Button size="sm" onclick={startEdit}><Icon name="pencil" size={16} />Edit profile</Button>
      {/if}
    {:else if session.user}
      <FollowButton small following={profile.people.isFollowing} label="Follow @{profile.handle}" busy={followBusy} onclick={toggleFollow} />
    {:else}
      <FollowButton small label="Follow @{profile.handle}" href="/login?next={encodeURIComponent(page.url.pathname)}" />
    {/if}
  {/snippet}
</PageHeader>
{#snippet bio()}<span class="bio">{profile.bio}</span>{/snippet}

{#if profile.isMe && pendingFile}
  <AvatarCropDialog file={pendingFile} onclose={() => (pendingFile = null)} onsaved={onAvatarSaved} />
{/if}

{#if people}
  <PeopleSheet handle={profile.handle} which={people} isMe={profile.isMe} onclose={() => (people = null)} />
{/if}

<style>
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
  /* Editing name, bio and homepage right in the header. */
  .edit { display: flex; flex-direction: column; gap: var(--space-5); }
  .editrow { display: flex; justify-content: flex-end; gap: var(--space-2); }
  /* The counts are buttons that read as part of the handle line: the number in the text color, the word quieter. */
  .people { padding: 0; font: inherit; color: var(--text-2); }
  .people strong { color: var(--text); font-weight: 600; }
  @media (hover: hover) { .people:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .people:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }
</style>
