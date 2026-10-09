<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Card from '$lib/components/Card.svelte';
  import { api, authApi } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { display, setDisplay, APPEARANCES, READING_MODES, LAYOUTS, FRESH_OPTIONS, type Display } from '$lib/display.svelte';
  import Tiles from '$lib/components/display/Tiles.svelte';
  import ThemePicker from '$lib/components/display/ThemePicker.svelte';
  import FontTable from '$lib/components/display/FontTable.svelte';
  import { appearanceArt, READING_ART, LAYOUT_ART, FRESH_ART } from '$lib/components/display/art';
  import { showToast } from '$lib/toast.svelte';
  import { isSource, saveForNewDevices, stopBeingSource } from '$lib/saved-display.svelte';

  /**
   * Your private preferences: reading, whose notes you see, feed defaults,
   * tracking. Your email and password are on the Account page
   * (routes/account). Who you are in public — name, bio, homepage, and who
   * can see each part of your profile — is edited on the profile itself
   * (routes/@[handle]), so those choices sit where you can see their effect.
   *
   * Nearly everything here saves the moment it changes. Display is the odd one
   * out twice over: it is kept in this browser rather than on the account, and
   * applies the moment you pick it. See lib/display.svelte.ts. "Use these
   * settings on new devices" makes this device the one new devices copy, kept
   * up to date as it changes (issue #186, lib/saved-display.svelte.ts).
   */
  let savingDisplay = $state(false);
  async function toggleSource(e: Event & { currentTarget: HTMLInputElement }) {
    const box = e.currentTarget;
    savingDisplay = true;
    const ok = box.checked ? await saveForNewDevices('settings') : await stopBeingSource();
    if (ok && !box.checked) showToast('New devices will offer the settings saved last');
    savingDisplay = false;
    // A save that didn't go through leaves the box as it was.
    box.checked = isSource();
  }
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

  const tracking = $derived(me.trackActivity ?? me.instanceTracking);

  function choose(patch: Partial<Omit<Display, 'fonts'>>, key: string) { setDisplay(patch); api.event('display_changed', { key, value: Object.values(patch)[0] }); }

</script>

<svelte:head><title>Settings · thicket</title></svelte:head>

<PageHeader name="Settings">
  {#snippet description()}How thicket looks and how reading in it works.{/snippet}
</PageHeader>

<Card kind="section" as="section" class="setting">
  <label class="switch">
    <input type="checkbox" checked={isSource()} disabled={savingDisplay} onchange={toggleSource} />
    <span>
      <strong>Use these settings on new devices</strong>
      <small>New devices you sign into will offer the display settings below, kept up to date as you change them here. Each device keeps its own settings.</small>
    </span>
  </label>
</Card>

<Card kind="section" as="section" class="setting" id="display">
  <h2>Appearance</h2>
  <Tiles name="Appearance" options={APPEARANCES} value={display.appearance} art={appearanceArt(display.palette, display.accent)} onchange={(v) => choose({ appearance: v }, 'appearance')} />
</Card>

<Card kind="section" as="section" class="setting">
  <h2>Color theme</h2>
  <ThemePicker />
</Card>

<Card kind="section" as="section" class="setting">
  <h2>Fonts</h2>
  <FontTable />
</Card>

<Card kind="section" as="section" class="setting">
  <h2>Opening a post</h2>
  <Tiles name="Opening a post" options={READING_MODES} value={display.reading} art={READING_ART} notes onchange={(v) => choose({ reading: v }, 'reading')} />
</Card>

<Card kind="section" as="section" class="setting">
  <h2>Unread posts</h2>
  <Tiles name="Unread posts" options={FRESH_OPTIONS} value={display.fresh ? 'on' : 'off'} art={FRESH_ART} notes onchange={(v) => choose({ fresh: v === 'on' }, 'fresh')} />
</Card>

<Card kind="section" as="section" class="setting">
  <h2>Scrolling or pages</h2>
  <Tiles name="Scrolling or pages" options={LAYOUTS} value={display.layout} art={LAYOUT_ART} notes onchange={(v) => choose({ layout: v }, 'layout')} />
</Card>


<Card kind="section" as="section" class="setting">
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
</Card>

<Card kind="section" as="section" class="setting">
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
</Card>

{#if me.instanceTracking}
  <Card kind="section" as="section" class="setting">
    <h2>Privacy</h2>
    <label class="switch">
      <input type="checkbox" checked={tracking} onchange={(e) => set({ trackActivity: e.currentTarget.checked }, e.currentTarget.checked ? 'Usage tracking on' : 'Usage tracking off')} />
      <span>
        <strong>Help improve thicket by sharing anonymous usage data</strong>
        <small>Which screens and buttons you use — never what you read. There’s no record of which posts you open.</small>
      </span>
    </label>
  </Card>
{/if}


{#if me.isAdmin}
  <Card kind="section" as="section" class="setting admin">
    <h2>Admin</h2>
    <p class="help">You’re an admin of this instance. Sign ups, invites, and accounts live on the <a href="/admin">Admin page</a>.</p>
  </Card>
{/if}

<style>
  /* The page has no element of its own around its sections, so the room between them is set on the cards' own class. */
  :global(.setting) { margin-bottom: var(--space-4); }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0 0 var(--space-3); line-height: 1.25; }
  /* When a description follows the header, pull it up tight; the header's gap then sits under the description. */
  h2 + .help { margin-top: calc(-1 * var(--space-2)); }
  .help { margin: 0 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  fieldset { border: 0; padding: 0; margin: var(--space-3) 0 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .radio, .switch { display: flex; flex-direction: row; align-items: flex-start; gap: var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 400; color: var(--text); cursor: pointer; }
  .radio input, .switch input { margin-top: var(--space-1); width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  /* The ring these used to borrow from the password boxes, now said outright.
     A tick box or a dial isn't typed into, so the browser only calls it
     keyboard focus when you tabbed to it — no special handling needed. */
  .radio input:focus-visible, .switch input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  /* 2px between a choice and its explanation is optical, not a spacing step. */
  .radio span, .switch span { display: flex; flex-direction: column; gap: 2px; }
  .radio small, .switch small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  :global(.admin) .help a { color: var(--accent); font-weight: 600; }
</style>
