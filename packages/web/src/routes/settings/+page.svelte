<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, authApi, profileHref, ApiError, type ShareLevel } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { appearance, setFont, setTheme, FONTS, THEMES, type Font, type Theme } from '$lib/theme.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * Everything about you that isn't reading. Text fields save with the button;
   * toggles save the moment they change. Visibility is layered: the whole
   * profile, then each section; per-collection privacy lives on the
   * collection's manage page.
   *
   * Appearance is the odd one out: it is kept in this browser, not on the
   * account, and applies the moment you pick it. See lib/theme.svelte.ts.
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

  /**
   * The three shareable parts of a profile. Each has its own audience, and
   * "People I follow" means exactly that: following someone is how you share
   * with them. Someone following you gains nothing by it.
   */
  type VisKey = 'collectionsVisibility' | 'bookmarksVisibility' | 'notesVisibility';
  const LEVELS: { value: ShareLevel; label: string }[] = [
    { value: 'private', label: 'Only me' },
    { value: 'friends', label: 'People I follow' },
    { value: 'public', label: 'Anyone' }
  ];
  const SECTIONS: { key: VisKey; label: string; blurb: Record<ShareLevel, string> }[] = [
    { key: 'collectionsVisibility', label: 'My collections', blurb: {
      private: 'Nobody else can see any of your collections.',
      friends: 'The people you follow can see them. To hide just one, open it, press Settings and switch it to Private.',
      public: 'Anyone can see them. To hide just one, open it, press Settings and switch it to Private.' } },
    { key: 'bookmarksVisibility', label: 'My bookmarks', blurb: {
      private: 'Only you can see what you have saved.',
      friends: 'The people you follow can browse them and save any to their own.',
      public: 'Anyone can browse them and save any to their own.' } },
    { key: 'notesVisibility', label: 'My notes', blurb: {
      private: 'Your notes are only ever yours.',
      friends: 'The people you follow see them under posts, and in your recent activity.',
      public: 'Anyone sees them under posts, and in the recent activity on your profile.' } }
  ];
  const setVis = (sec: { key: VisKey; label: string }, l: { value: ShareLevel; label: string }) =>
    set({ [sec.key]: l.value } as Parameters<typeof authApi.update>[0], `${sec.label}: ${l.label.toLowerCase()}`);

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

  function chooseTheme(t: Theme) { setTheme(t); api.event('theme_changed', { theme: t }); }
  function chooseFont(f: Font) { setFont(f); api.event('font_changed', { font: f }); }

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
  <h2>Appearance</h2>
  <p class="help">Kept on this device rather than your account, so each screen you read on can differ. Changes apply as you pick them.</p>
  <fieldset>
    <legend>Theme</legend>
    {#each THEMES as t (t.id)}
      <label class="radio">
        <input type="radio" name="theme" value={t.id} checked={appearance.theme === t.id} onchange={() => chooseTheme(t.id)} />
        <span><strong>{t.label}</strong><small>{t.note}</small></span>
      </label>
    {/each}
  </fieldset>
  <fieldset class="fonts">
    <legend>Reading font</legend>
    {#each FONTS as f (f.id)}
      <label class="radio">
        <input type="radio" name="font" value={f.id} checked={appearance.font === f.id} onchange={() => chooseFont(f.id)} />
        <span>
          <strong>{f.label}</strong><small>{f.note}</small>
          <span class="sample" data-sample={f.id}>Whatever you read, it arrives here in order.</span>
        </span>
      </label>
    {/each}
  </fieldset>
  <p class="help foot">Colour themes beyond light and dark are coming; for now these two are the choice.</p>
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
  <div class="shares" class:dim={me.profileVisibility === 'private'}>
    <p class="help">Each part of your profile has its own audience. <strong>People I follow</strong> means the people you have chosen to follow — someone following you gains nothing by it.</p>
    {#each SECTIONS as sec (sec.key)}
      <div class="share">
        <strong>{sec.label}</strong>
        <div class="seg" role="radiogroup" aria-label={sec.label}>
          {#each LEVELS as l (l.value)}
            <button type="button" role="radio" aria-checked={me[sec.key] === l.value} class:on={me[sec.key] === l.value} onclick={() => setVis(sec, l)}>{l.label}</button>
          {/each}
        </div>
        <small>{sec.blurb[me[sec.key]]}</small>
      </div>
    {/each}
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
  <h2>Feed setting defaults</h2>
  <p class="help">What every feed does unless you change it in that feed’s own settings.</p>
  <fieldset>
    <legend>YouTube</legend>
    <label class="radio">
      <input type="radio" name="shortsDefault" value="videos" checked={me.hideShortsByDefault} onchange={() => set({ hideShortsByDefault: true }, 'YouTube channels now show videos only')} />
      <span><strong>Videos</strong><small>Shorts are left out of every channel you read, unless you turn them back on for one.</small></span>
    </label>
    <label class="radio">
      <input type="radio" name="shortsDefault" value="all" checked={!me.hideShortsByDefault} onchange={() => set({ hideShortsByDefault: false }, 'YouTube channels now show videos and Shorts')} />
      <span><strong>Videos + Shorts</strong><small>Everything a channel posts. You can still hide Shorts on any one channel.</small></span>
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
  legend { padding: 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
  .fonts { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
  /* Each sample is set in the face it names, so the choice is visible before it is made. */
  .sample { margin-top: 4px; font-size: 15px; color: var(--text-2); }
  .sample[data-sample='sans'] { font-family: var(--font-sans); }
  .sample[data-sample='serif'] { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
  .sample[data-sample='dyslexic'] { font-family: 'OpenDyslexic', var(--font-sans); }
  .foot { margin: 14px 0 0; }
  .radio, .switch { flex-direction: row; align-items: flex-start; gap: 12px; font-weight: 400; color: var(--text); cursor: pointer; }
  .radio input, .switch input { margin-top: 3px; width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .radio span, .switch span { display: flex; flex-direction: column; gap: 2px; }
  .radio small, .switch small { font-size: 13px; color: var(--text-3); }
  .shares.dim { opacity: 0.55; }
  .shares { display: flex; flex-direction: column; gap: 18px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
  .share { display: flex; flex-direction: column; gap: 7px; }
  .share small { font-size: 13px; color: var(--text-3); }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .seg button { flex: 1; padding: 9px 6px; font-size: 13px; font-weight: 600; color: var(--text-3); background: var(--surface); border-left: 1px solid var(--line); }
  .seg button:first-child { border-left: 0; }
  .seg button.on { background: var(--accent); color: var(--accent-ink); }
  .bad { color: var(--danger); margin: 0; font-size: 14px; }
  .admin .help a { color: var(--accent); font-weight: 600; }
  .out { text-align: center; margin: 24px 0 0; }
  .out button { color: var(--danger); }
</style>
