<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, authApi, profileHref, ApiError } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * Everything about you that isn't reading. Text fields save with the button;
   * toggles save the moment they change. Visibility is layered: the whole
   * profile, then each section; per-collection privacy lives on the
   * collection's manage page.
   */
  const me = $derived(session.user!);
  let displayName = $state('');
  let bio = $state('');
  let homepageUrl = $state('');
  let saving = $state(false);
  let seeded = $state(false);
  $effect(() => {
    if (seeded || !session.user) return;
    seeded = true;
    displayName = session.user.displayName ?? '';
    bio = session.user.bio ?? '';
    homepageUrl = session.user.homepageUrl ?? '';
  });
  const dirty = $derived(displayName !== (me.displayName ?? '') || bio !== (me.bio ?? '') || homepageUrl !== (me.homepageUrl ?? ''));

  async function saveProfile() {
    if (saving) return;
    saving = true;
    try {
      setMe(await authApi.update({ displayName: displayName || null, bio: bio || null, homepageUrl: homepageUrl || null }));
      homepageUrl = session.user?.homepageUrl ?? '';
      api.event('profile_updated');
      showToast('Profile saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      saving = false;
    }
  }

  async function set(patch: Parameters<typeof authApi.update>[0], label: string) {
    try {
      setMe(await authApi.update(patch));
      api.event('settings_changed', { keys: Object.keys(patch) });
      showToast(label);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }

  let current = $state('');
  let next = $state('');
  let pwError = $state<string | null>(null);
  let pwBusy = $state(false);
  async function changePassword() {
    if (pwBusy) return;
    pwBusy = true; pwError = null;
    try {
      await authApi.changePassword(current, next);
      current = ''; next = '';
      showToast('Password changed. Other devices were signed out.');
    } catch (e) {
      pwError = e instanceof ApiError ? e.message : String(e);
    } finally {
      pwBusy = false;
    }
  }

  /**
   * Leave first, then forget the user. Settings is not a public page, so
   * forgetting first makes the layout redirect to /login?next=/settings and
   * the next person to log in would land in this user's settings. Home is
   * public: signed out, it becomes the front door.
   */
  async function logout() {
    await authApi.logout();
    await goto('/', { replaceState: true });
    setMe(null);
  }

  const tracking = $derived(me.trackActivity ?? me.instanceTracking);

</script>

<svelte:head><title>Settings · thicket</title></svelte:head>

<header class="top">
  <h1>Settings</h1>
  <p class="sub"><a href={profileHref(me.handle)}>View your profile ↗</a></p>
</header>

<section class="card">
  <h2>Profile</h2>
  <p class="help">All optional. Your handle, <strong>@{me.handle}</strong>, is the one thing that’s fixed.</p>
  <form onsubmit={(e) => { e.preventDefault(); void saveProfile(); }}>
    <label><span>Display name</span><input type="text" bind:value={displayName} maxlength="60" placeholder={me.handle} /></label>
    <label><span>About you</span><textarea bind:value={bio} rows="3" maxlength="500" placeholder="A line or two. What you read, what you make."></textarea></label>
    <label><span>Homepage</span><input type="url" inputmode="url" bind:value={homepageUrl} placeholder="https://" /></label>
    <div class="row"><button type="submit" class="primary" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save profile'}</button></div>
  </form>
</section>

<section class="card">
  <h2>Who can see your profile</h2>
  <fieldset>
    <label class="radio">
      <input type="radio" name="vis" value="public" checked={me.profileVisibility === 'public'} onchange={() => set({ profileVisibility: 'public' }, 'Profile is public')} />
      <span><strong>Public</strong><small>Anyone can open /@{me.handle} and see what you choose to show below.</small></span>
    </label>
    <label class="radio">
      <input type="radio" name="vis" value="private" checked={me.profileVisibility === 'private'} onchange={() => set({ profileVisibility: 'private' }, 'Profile is private')} />
      <span><strong>Private</strong><small>Nothing is shown to anyone. You still count toward feed follower numbers, but no one can see it’s you.</small></span>
    </label>
  </fieldset>
  <div class="toggles" class:dim={me.profileVisibility === 'private'}>
    <label class="switch">
      <input type="checkbox" checked={me.showCollections} onchange={(e) => set({ showCollections: e.currentTarget.checked }, e.currentTarget.checked ? 'Collections shown on your profile' : 'Collections hidden')} />
      <span><strong>Show my collections</strong><small>All of them, or none. To hide just one, open the collection, choose <strong>Manage this collection</strong> from its ⋯ menu, and switch it to Private; private collections never show here even when this is on.</small></span>
    </label>
    <label class="switch">
      <input type="checkbox" checked={me.showBookmarks} onchange={(e) => set({ showBookmarks: e.currentTarget.checked }, e.currentTarget.checked ? 'Bookmarks shown on your profile' : 'Bookmarks hidden')} />
      <span><strong>Show my bookmarks</strong><small>Others can browse them and save any to their own.</small></span>
    </label>
    <label class="switch">
      <input type="checkbox" checked={me.showNotes} onchange={(e) => set({ showNotes: e.currentTarget.checked }, e.currentTarget.checked ? 'Your notes can be seen by others' : 'Your notes are yours alone')} />
      <span><strong>Share my notes</strong><small>People who follow you (or everyone, if they choose) see your notes under posts they come across. Off, and your notes are only ever yours.</small></span>
    </label>
  </div>
</section>

<section class="card">
  <h2>Notes from other people</h2>
  <p class="help">Whose notes appear under posts as you read. Yours always do.</p>
  <fieldset>
    <label class="radio">
      <input type="radio" name="notesFrom" value="none" checked={me.notesFrom === 'none'} onchange={() => set({ notesFrom: 'none' }, 'Showing only your own notes')} />
      <span><strong>No one</strong><small>Just your own notes.</small></span>
    </label>
    <label class="radio">
      <input type="radio" name="notesFrom" value="following" checked={me.notesFrom === 'following'} onchange={() => set({ notesFrom: 'following' }, 'Showing notes from people you follow')} />
      <span><strong>People I follow</strong><small>The default. Follow someone from their profile and their notes start showing on posts you both see.</small></span>
    </label>
    <label class="radio">
      <input type="radio" name="notesFrom" value="everyone" checked={me.notesFrom === 'everyone'} onchange={() => set({ notesFrom: 'everyone' }, 'Showing notes from everyone')} />
      <span><strong>Everyone</strong><small>Any note anyone on this thicket has chosen to share.</small></span>
    </label>
  </fieldset>
</section>

<section class="card">
  <h2>Privacy</h2>
  <label class="switch">
    <input type="checkbox" checked={tracking} disabled={!me.instanceTracking} onchange={(e) => set({ trackActivity: e.currentTarget.checked }, e.currentTarget.checked ? 'Usage tracking on' : 'Usage tracking off')} />
    <span>
      <strong>Help improve thicket with usage data</strong>
      <small>{#if me.instanceTracking}Which screens and buttons you use. Never what you read: there is no record of which posts you open.{:else}This instance has tracking turned off entirely.{/if}</small>
    </span>
  </label>
</section>

<section class="card">
  <h2>Password</h2>
  <form onsubmit={(e) => { e.preventDefault(); void changePassword(); }}>
    <label><span>Current password</span><input type="password" bind:value={current} autocomplete="current-password" required /></label>
    <label><span>New password</span><input type="password" bind:value={next} autocomplete="new-password" required minlength="8" /></label>
    {#if pwError}<p class="bad" role="alert">{pwError}</p>{/if}
    <div class="row"><button type="submit" disabled={pwBusy || !current || next.length < 8}>{pwBusy ? 'Changing…' : 'Change password'}</button></div>
  </form>
</section>

{#if me.isAdmin}
  <section class="card admin">
    <h2>Admin</h2>
    <p class="help">You’re an admin of this instance. Sign-ups, invites and accounts live on the <a href="/admin">Admin page</a>.</p>
  </section>
{/if}

<p class="out"><button onclick={logout}>Log out</button></p>

<style>
  .top { margin-bottom: 14px; }
  h1 { font-family: var(--font-serif); font-size: 28px; margin: 0; }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: 14px; }
  .sub a { color: var(--accent); font-weight: 600; }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; margin-bottom: 14px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .help { margin: 0 0 14px; font-size: 14px; color: var(--text-3); }
  form { display: flex; flex-direction: column; gap: 12px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-2); }
  input[type='text'], input[type='url'], input[type='password'], textarea { padding: 11px 13px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: 16px; font-family: inherit; resize: vertical; }
  input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row { display: flex; justify-content: flex-end; }
  button { padding: 10px 16px; border-radius: 999px; border: 1px solid var(--line); font-weight: 600; font-size: 14px; color: var(--text-2); background: var(--surface); }
  button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  button:disabled { opacity: 0.5; }
  fieldset { border: 0; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 10px; }
  .radio, .switch { flex-direction: row; align-items: flex-start; gap: 12px; font-weight: 400; color: var(--text); cursor: pointer; }
  .radio input, .switch input { margin-top: 3px; width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .radio span, .switch span { display: flex; flex-direction: column; gap: 2px; }
  .radio small, .switch small { font-size: 13px; color: var(--text-3); }
  .toggles { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
  .toggles.dim { opacity: 0.55; }
  .bad { color: var(--danger); margin: 0; font-size: 14px; }
  .admin .help a { color: var(--accent); font-weight: 600; }
  .out { text-align: center; margin: 24px 0 0; }
  .out button { color: var(--danger); }
</style>
