<script lang="ts">
  import { api, authApi, ApiError } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { display, setDisplay, APPEARANCES, READING_MODES, LAYOUTS, FRESH_OPTIONS, type Display } from '$lib/display.svelte';
  import Tiles from '$lib/components/display/Tiles.svelte';
  import ThemePicker from '$lib/components/display/ThemePicker.svelte';
  import FontTable from '$lib/components/display/FontTable.svelte';
  import { APPEARANCE_ART, READING_ART, LAYOUT_ART, FRESH_ART } from '$lib/components/display/art';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * Your private preferences: reading, whose notes you see, feed defaults,
   * tracking, password. Who you are in public — name, bio, homepage, and who
   * can see each part of your profile — is edited on the profile itself
   * (routes/@[handle]), so those choices sit where you can see their effect.
   *
   * Nearly everything here saves the moment it changes. Display is the odd one
   * out twice over: it is kept in this browser rather than on the account, and
   * applies the moment you pick it. See lib/display.svelte.ts.
   */
  const me = $derived(session.user!);

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
  /* The server says which of the two boxes is wrong — a mistyped current
     password, or a new one that's too short — so the message lands on that
     box. Anything else (the network, say) is about neither, so it sits under
     the pair. */
  let pwError = $state<{ message: string; field?: string } | null>(null);
  let pwBusy = $state(false);
  async function changePassword() {
    if (pwBusy) return;
    pwBusy = true; pwError = null;
    try {
      await authApi.changePassword(current, next);
      current = ''; next = '';
      showToast('Password changed. Other devices were signed out.');
    } catch (e) {
      pwError = e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) };
    } finally {
      pwBusy = false;
    }
  }

  const tracking = $derived(me.trackActivity ?? me.instanceTracking);

  function choose(patch: Partial<Omit<Display, 'fonts'>>, key: string) { setDisplay(patch); api.event('display_changed', { key, value: Object.values(patch)[0] }); }

</script>

<svelte:head><title>Settings · thicket</title></svelte:head>

<header class="top">
  <h1>Settings</h1>
</header>

<section class="card">
  <h2>Appearance</h2>
  <p class="help">Display settings are per device, so each screen you read on can differ. Changes immediately apply.</p>
  <Tiles name="Appearance" options={APPEARANCES} value={display.appearance} art={APPEARANCE_ART} onchange={(v) => choose({ appearance: v }, 'appearance')} />
</section>

<section class="card">
  <h2>Color theme</h2>
  <ThemePicker />
</section>

<section class="card">
  <h2>Fonts</h2>
  <FontTable />
</section>

<section class="card">
  <h2>Opening a post</h2>
  <Tiles name="Opening a post" options={READING_MODES} value={display.reading} art={READING_ART} notes onchange={(v) => choose({ reading: v }, 'reading')} />
</section>

<section class="card">
  <h2>What’s new</h2>
  <Tiles name="What’s new" options={FRESH_OPTIONS} value={display.fresh ? 'on' : 'off'} art={FRESH_ART} notes onchange={(v) => choose({ fresh: v === 'on' }, 'fresh')} />
  <p class="fine">These counts are kept in your browser, not your account, so each device keeps its own. As you scroll a collection, your browser marks the newest post you’ve passed, and “new” means everything that’s arrived since. A collection you haven’t opened on this device starts from a day ago, so it shows today’s posts instead of a long backlog. None of this reaches our servers — not your spot in a collection, not which posts you open or read.</p>
</section>

<section class="card">
  <h2>Moving through the list</h2>
  <Tiles name="Moving through the list" options={LAYOUTS} value={display.layout} art={LAYOUT_ART} notes onchange={(v) => choose({ layout: v }, 'layout')} />
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
      <span><strong>Everyone</strong><small>Any note anyone has chosen to share.</small></span>
    </label>
  </fieldset>
</section>

<section class="card">
  <h2>YouTube</h2>
  <p class="help">What every YouTube channel shows unless you change it on that channel.</p>
  <fieldset>
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

{#if me.instanceTracking}
  <section class="card">
    <h2>Privacy</h2>
    <label class="switch">
      <input type="checkbox" checked={tracking} onchange={(e) => set({ trackActivity: e.currentTarget.checked }, e.currentTarget.checked ? 'Usage tracking on' : 'Usage tracking off')} />
      <span>
        <strong>Help improve thicket by sharing anonymous usage data</strong>
        <small>Which screens and buttons you use — never what you read. There’s no record of which posts you open.</small>
      </span>
    </label>
  </section>
{/if}

<section class="card">
  <h2>Change password</h2>
  <form onsubmit={(e) => { e.preventDefault(); void changePassword(); }}>
    <Field label="Current password" error={pwError?.field === 'current' ? pwError.message : null}>
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} inset type="password" bind:value={current} autocomplete="current-password" required />
      {/snippet}
    </Field>
    <Field label="New password" hint="At least 8 characters." error={pwError?.field === 'next' ? pwError.message : null}>
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} inset type="password" bind:value={next} autocomplete="new-password" required minlength={8} />
      {/snippet}
    </Field>
    {#if pwError && !pwError.field}<p class="bad" role="alert">{pwError.message}</p>{/if}
    <div class="row"><button type="submit" disabled={pwBusy || !current || next.length < 8}>{pwBusy ? 'Changing…' : 'Change password'}</button></div>
  </form>
</section>

{#if me.isAdmin}
  <section class="card admin">
    <h2>Admin</h2>
    <p class="help">You’re an admin of this instance. Sign-ups, invites and accounts live on the <a href="/admin">Admin page</a>.</p>
  </section>
{/if}

<style>
  .top { margin-bottom: var(--space-4); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: var(--space-4); margin-bottom: var(--space-4); }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0 0 var(--space-3); line-height: 1.25; }
  /* When a description follows the header, pull it up tight; the header's gap then sits under the description. */
  h2 + .help { margin-top: calc(-1 * var(--space-2)); }
  .help { margin: 0 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); line-height: 1.4; }
  .fine { margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); line-height: 1.45; max-width: 66ch; }
  form { display: flex; flex-direction: column; gap: var(--space-3); }
  .row { display: flex; justify-content: flex-end; }
  button { padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--line); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); background: var(--surface); }
  button:disabled { opacity: 0.5; }
  fieldset { border: 0; padding: 0; margin: var(--space-3) 0 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .radio, .switch { display: flex; flex-direction: row; align-items: flex-start; gap: var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 400; color: var(--text); cursor: pointer; }
  .radio input, .switch input { margin-top: var(--space-1); width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  /* The ring these used to borrow from the password boxes, now said outright.
     A tick box or a dial isn't typed into, so the browser only calls it
     keyboard focus when you tabbed to it — no special handling needed. */
  .radio input:focus-visible, .switch input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* 2px between a choice and its explanation is optical, not a spacing step. */
  .radio span, .switch span { display: flex; flex-direction: column; gap: 2px; }
  .radio small, .switch small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .admin .help a { color: var(--accent); font-weight: 600; }
</style>
