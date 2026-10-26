<script lang="ts">
  /**
   * First time on a new device: one screen that lists how thicket looks here
   * (light or dark, color theme, fonts, how a post opens), each with its
   * current choice. Open any of them to change it and come back, or keep them
   * all and go on in one step. Every choice applies as it is made, so the page
   * behind the dialog is the preview. Opening the dialog writes this device's
   * record, which is what makes it a once-only thing: closing it any way at
   * all is the same as finishing it. Settings has the same choices later.
   *
   * When the account has saved settings (issue #186), a device that hasn't
   * been set up takes them on at once, and the list says that's where they
   * came from, so changing one is a tap away rather than a question first.
   * A new account's first setup becomes its saved settings, however it ends.
   *
   * A new account (under a day old), or anyone who follows nothing yet, gets
   * an import step first, because bringing their feeds is the thing that
   * matters most on day one. A new account counts even if it already follows
   * feeds: one shared collection copied on sign-up says nothing about the
   * reader they came from. When that copy is what brought them, the first
   * step says so at the top, and the page behind is their copy. Picking a
   * file says what was found, then the rest goes by while the feeds are
   * checked in the background, and leaving setup any way at all opens their
   * review. The dialog opens once per device, not per account, so a second
   * device a day or more later only asks when there is still nothing
   * followed.
   *
   * After the list comes the tour, once per account (Tour.svelte).
   *
   * A brand-new account skips all of this (THICKET-34): New posts is where it
   * picks something to read, the tour follows once there are posts, and
   * New posts then offers these same choices in a note, whose Choose opens
   * this dialog on the list alone (lib/firstrun.svelte.ts).
   */
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { display, describeDisplay, markConfigured, setDisplay, useDisplay, APPEARANCES, READING_MODES, LAYOUTS, FRESH_OPTIONS } from '$lib/display.svelte';
  import Tiles from './Tiles.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import FontTable from './FontTable.svelte';
  import { appearanceArt, READING_ART, LAYOUT_ART, FRESH_ART } from './art';
  import Button from '$lib/components/Button.svelte';
  import ImportHelp from '$lib/components/ImportHelp.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import SettingRow from '$lib/components/SettingRow.svelte';
  import { imp, startOverImport } from '$lib/importer.svelte';
  import { session } from '$lib/session.svelte';
  import { welcome } from '$lib/copyintent.svelte';
  import { saveFirstSetup, setupVisit } from '$lib/saved-display.svelte';
  import { accountIsNew, choices, isNewcomer, tour } from '$lib/firstrun.svelte';

  type Setting = 'appearance' | 'theme' | 'fonts' | 'reading' | 'layout' | 'fresh';
  /** Where setup is: import, the list, or one setting opened from it. */
  type View = 'import' | 'list' | Setting;

  let dialog = $state<HTMLDialogElement | null>(null);
  let open = $state(false);
  let view = $state<View>('list');
  let withImport = $state(false);
  const SETTINGS: Record<Setting, { title: string; lead: string }> = {
    appearance: { title: 'Light or dark', lead: 'Or match your device' },
    theme: { title: 'Color theme', lead: 'Crisp has the most contrast, the Soft themes the least' },
    fonts: { title: 'Fonts', lead: 'Headlines, text, and the app can each have their own' },
    reading: { title: 'Opening a post', lead: 'Read here or on the post’s own site' },
    layout: { title: 'Scrolling or pages', lead: 'Scroll through posts, or turn a page at a time' },
    fresh: { title: 'Unread posts', lead: 'A count of new posts in the sidebar' }
  };
  /** The tour follows (it starts itself as this closes): decided when setup opens, for the last button's word. */
  let withTour = $state(false);
  /**
   * Skip the list: a device that's already set up opening for an account that
   * hasn't seen the tour. Only import (if it applies) and the tour are left.
   */
  let tourOnly = $state(false);
  /** Opened from New posts' appearance note: the list alone, then out. */
  let listOnly = $state(false);
  /** The dev reopening with ?setup: the tour runs after, even for an account that has seen it. */
  let reviewing = false;
  /** This device just took on the account's saved settings. */
  let fromSaved = $state(false);
  let heading = $state<HTMLElement | null>(null);
  let rows = $state<HTMLElement | null>(null);
  /** What each setting was when setup opened; a row whose choice differs since gets a check. */
  let initial = $state<Record<string, string>>({});
  /** The setting just closed, so the keyboard lands back on its row. */
  let cameFrom: Setting | null = null;
  // Each new screen moves the keyboard to its heading, or back to the row it came from.
  $effect(() => {
    const v = view;
    tick().then(() => {
      if (v === 'list' && cameFrom) rows?.querySelector<HTMLElement>(`[data-key="${cameFrom}"]`)?.focus();
      else heading?.focus();
    });
  });
  /** A file has been read, so leaving setup leads to its review. */
  const importing = $derived(withImport && imp.step === 'review');
  const header = $derived(
    // Once a file is read, the question under the title has been answered, so it goes.
    view === 'import' ? { title: 'Import your feeds', lead: importing ? '' : 'Coming from another reader?' }
    : view === 'list' ? { title: 'Set up your device', lead: fromSaved ? 'These are the settings you saved on another device' : 'You can update your choices at any time in Settings' }
    : SETTINGS[view]
  );

  // Setup opens on a device that's never been set up, and also for an account
  // that hasn't seen the tour: display settings belong to the device, so a
  // second account made on a set-up device would otherwise never get it.
  onMount(() => { if (!display.configured || (session.user && !session.user.tourSeenAt)) start(); });

  // New posts' appearance note asks for the list alone.
  $effect(() => {
    if (!choices.requested) return;
    choices.requested = false;
    if (open || starting) return;
    listOnly = true; withImport = false; withTour = false; tourOnly = false; fromSaved = false; cameFrom = null;
    initial = Object.fromEntries(describeDisplay(display).map((r) => [r.key, r.value]));
    view = 'list';
    open = true;
    api.event('display_setup_shown', { listOnly });
    queueMicrotask(() => { dialog?.showModal(); heading?.focus(); });
  });

  // In development, ?setup opens the walkthrough again on a screen that has
  // already seen it. Watched rather than read once: signing in lands on the
  // address without reloading the page, after this has already started.
  let reopenedFor = '';
  $effect(() => {
    if (!import.meta.env.DEV || !page.url.searchParams.has('setup') || open || reopenedFor === page.url.href) return;
    reopenedFor = page.url.href;
    start(true);
  });

  /** Between asking to open and the dialog showing, so the two ways in can't both open it. */
  let starting = false;

  /**
   * Everything about what this visit shows is decided here, once: opening
   * marks the device set up and the tour can be recorded partway, so deciding
   * again later would match other rules mid-flow. `again`: the dev reopening,
   * which includes the tour even for an account that has seen it, so it can
   * be reviewed.
   */
  function start(again = false) {
    if (starting || open) return;
    // A new account: nothing to set up first. Its device counts as set up, and
    // its settings are saved for new devices when the tour ends.
    if (!again && isNewcomer()) {
      setupVisit.opened = true;
      markConfigured();
      return;
    }
    starting = true;
    setupVisit.opened = true;
    listOnly = false;
    cameFrom = null;
    // ?setup in development always includes import and the tour, also when it's
    // this device's real first setup (a new dev port is a new device to the
    // browser), so the whole walkthrough can be reviewed on any account.
    const review = again || (import.meta.env.DEV && page.url.searchParams.has('setup'));
    reviewing = review;
    withTour = review || !session.user?.tourSeenAt;
    const saved = !again && !display.configured ? session.user?.savedDisplay ?? null : null;
    fromSaved = !!saved;
    tourOnly = !again && display.configured && withTour;
    if (saved) useDisplay(saved);
    else markConfigured();
    initial = Object.fromEntries(describeDisplay(display).map((r) => [r.key, r.value]));
    welcome.open = true;
    // Ask about importing on a new account, or when nothing is followed yet.
    // If that can't be found out, the dialog opens without it rather than not at all.
    api.riverStats()
      .then((s) => { withImport = review || accountIsNew() || s.feeds === 0; })
      .catch(() => {})
      .finally(() => {
        starting = false;
        // Nothing left to ask: no dialog, and the tour starts itself.
        if (tourOnly && !withImport) { welcome.open = false; if (review) tour.open = true; return; }
        view = withImport ? 'import' : 'list';
        open = true;
        api.event('display_setup_shown', { withImport, fromSaved, tourOnly });
        queueMicrotask(() => { dialog?.showModal(); heading?.focus(); });
      });
  }

  /** On from import: the list, or out (to the tour, if it's owed) when the list is skipped. */
  function afterImport() {
    if (!tourOnly) view = 'list';
    else finish('done');
  }

  function openSetting(key: Setting) { cameFrom = null; view = key; }
  function closeSetting() { cameFrom = view as Setting; view = 'list'; }

  function finish(how: 'done' | 'dismissed') {
    api.event('display_setup_closed', { how, step: view, withImport, importing, listOnly });
    saveFirstSetup();
    // Read before it's cleared: a copy made on arrival decides where this ends.
    const copiedOnArrival = !!welcome.copied;
    open = false;
    welcome.open = false;
    welcome.copied = null;
    dialog?.close();
    if (listOnly) return;
    // The tour, if it's owed, starts itself now that this is closed (once
    // something is followed). Reviewing in development, it starts regardless.
    if (reviewing) tour.open = true;
    // Once a file has been picked, every way out leads to choosing its feeds,
    // even while it's still being read: the import page picks up the reading
    // and shows the feeds when it finishes.
    if (importing || (withImport && imp.busy)) void goto('/import');
    // A setup that didn't import ends where someone following nothing picks
    // something to read: New posts. Unless a shared copy link just gave them
    // one, in which case Collections, with the copy in the list.
    else if (withImport) void goto(copiedOnArrival ? '/collections' : '/new-posts');
  }
</script>

{#if open}
  <dialog bind:this={dialog} onclose={() => { if (open) finish('dismissed'); }} onclick={(e) => { if (e.target === dialog) finish('dismissed'); }} aria-labelledby="setup-title">
    <div class="box">
      <header>
        {#if welcome.copied && !listOnly && (view === 'import' || (view === 'list' && !withImport))}<div class="copied"><Banner tone="success" title="Copied “{welcome.copied}” to your collections" /></div>{/if}
        <h2 id="setup-title" tabindex="-1" bind:this={heading}>{header.title}</h2>
        {#if header.lead}<p class="lead">{header.lead}</p>{/if}
      </header>

      <div class="body">
        {#if view === 'import'}
          {#if importing && imp.preview}
            {@const feeds = new Set(imp.groups.flatMap((g) => g.feeds.map((f) => f.url))).size}
            <div class="found" role="status">
              <Icon name="check" size={22} />
              <div>
                <p class="count">{feeds} {feeds === 1 ? 'feed' : 'feeds'} in {imp.groups.length} {imp.groups.length === 1 ? 'folder' : 'folders'}</p>
                <p class="then">After setup, you’ll pick which ones to follow</p>
                <div class="again"><Button variant="secondary" onclick={startOverImport}>Upload a different file</Button></div>
              </div>
            </div>
          {:else}
            <ImportHelp via="setup" />
          {/if}
        {:else if view === 'list'}
          <div class="rows" bind:this={rows}>
            {#each describeDisplay(display) as r (r.key)}
              <SettingRow label={r.label} value={r.value} changed={r.value !== initial[r.key]} onclick={() => openSetting(r.key)} data-key={r.key} />
            {/each}
          </div>
        {:else if view === 'appearance'}
          <Tiles name="Appearance" options={APPEARANCES} value={display.appearance} art={appearanceArt(display.palette, display.accent)} onchange={(v) => setDisplay({ appearance: v })} />
        {:else if view === 'theme'}
          <ThemePicker />
        {:else if view === 'fonts'}
          <FontTable compact />
        {:else if view === 'reading'}
          <Tiles name="Opening a post" options={READING_MODES} value={display.reading} art={READING_ART} notes onchange={(v) => setDisplay({ reading: v })} />
        {:else if view === 'layout'}
          <Tiles name="Scrolling or pages" options={LAYOUTS} value={display.layout} art={LAYOUT_ART} notes onchange={(v) => setDisplay({ layout: v })} />
        {:else if view === 'fresh'}
          <Tiles name="Unread posts" options={FRESH_OPTIONS} value={display.fresh ? 'on' : 'off'} art={FRESH_ART} notes onchange={(v) => setDisplay({ fresh: v === 'on' })} />
        {/if}
        {#if importing && imp.checking && view !== 'import'}<p class="status" aria-live="polite">Checking your feeds</p>{/if}
      </div>

      <footer>
        <span class="spacer"></span>
        {#if view === 'import'}
          <Button variant={importing ? 'primary' : 'ghost'} onclick={afterImport}>{importing ? 'Next' : 'Skip this step'}</Button>
        {:else if view === 'list'}
          {#if withImport}<Button onclick={() => { cameFrom = null; view = 'import'; }}>Back</Button>{/if}
          <Button variant="primary" onclick={() => finish('done')}>{listOnly ? 'Done' : withTour ? 'Next' : importing ? 'Review your feeds' : 'Start reading'}</Button>
        {:else}
          <Button variant="primary" onclick={closeSetting}>Back</Button>
        {/if}
      </footer>
    </div>
  </dialog>
{/if}

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  .box {
    position: fixed; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column;
    background: var(--surface); color: var(--text); border-radius: var(--radius-lg) var(--radius-lg) 0 0; max-height: 92vh;
    box-shadow: var(--shadow-sheet);
  }
  @media (min-width: 700px) {
    .box { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: min(720px, calc(100vw - 48px)); border-radius: var(--radius-lg); max-height: calc(100vh - 48px); }
  }
  header { padding: var(--space-5) var(--space-5) 0; }
  .copied { margin-bottom: var(--space-4); }
  h2:focus { outline: none; }
  .rows { display: flex; flex-direction: column; }
  h2 { margin: 0; font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.2; }
  .lead { margin: var(--space-1) 0 0; color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); max-width: 56ch; }
  .body { padding: var(--space-4) var(--space-5) var(--space-1); overflow-y: auto; min-height: 0; }
  footer { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-4) var(--space-5) calc(var(--space-4) + var(--safe-b)); border-top: 1px solid var(--line); margin-top: var(--space-3); }
  .found { display: flex; gap: var(--space-3); align-items: flex-start; color: var(--accent); }
  .found p { margin: 0; }
  /* 4px lines the check up with the middle of the first line, an optical nudge. */
  .found :global(svg) { flex: none; margin-top: 4px; }
  .count { font-size: calc(var(--text-lg) * var(--size-app)); font-weight: 600; color: var(--text); }
  .found .again { margin-top: var(--space-3); }
  .found .then { margin-top: var(--space-1); font-size: calc(var(--text-base) * var(--size-app)); color: var(--text-2); }
  .status { margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .spacer { flex: 1; }

</style>
