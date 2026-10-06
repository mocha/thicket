<script lang="ts">
  /**
   * First time on a new device: one screen that lists how thicket looks here
   * (light or dark, color theme, fonts, how a post opens), each with its
   * current choice. Open any of them to change it and come back, or keep them
   * all and go on in one step. Every choice applies as it is made, so the page
   * behind the dialog is the preview. Opening the dialog writes this device's
   * record, which is what makes it a once-only thing: closing it any way at
   * all is the same as finishing it. The full set of options stays on the
   * Settings page.
   *
   * When the account has saved settings (issue #186), a device that hasn't
   * been set up first asks whether to use them. Yes skips the list; no opens
   * it. A new account's first setup becomes its saved settings, however it
   * ends.
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
   * After the list, the window grows and turns into a short tour of how
   * thicket works, once per account: one screen per thing in the menu, each
   * with a picture of it that plays on a loop. Skip this tour leaves from any
   * of them and lands where the last one would.
   */
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, authApi } from '$lib/api';
  import { display, describeDisplay, markConfigured, setDisplay, useDisplay, APPEARANCES, READING_MODES, type Display } from '$lib/display.svelte';
  import Tiles from './Tiles.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import FontTable from './FontTable.svelte';
  import { appearanceArt, READING_ART } from './art';
  import Button from '$lib/components/Button.svelte';
  import ImportHelp from '$lib/components/ImportHelp.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import SettingRow from '$lib/components/SettingRow.svelte';
  import { MENU_ICONS } from '$lib/menu-icons';
  import NewPostsScene from '$lib/components/intro/NewPostsScene.svelte';
  import FeedsScene from '$lib/components/intro/FeedsScene.svelte';
  import BookmarksScene from '$lib/components/intro/BookmarksScene.svelte';
  import CollectionsScene from '$lib/components/intro/CollectionsScene.svelte';
  import ProfileScene from '$lib/components/intro/ProfileScene.svelte';
  import { imp } from '$lib/importer.svelte';
  import { session } from '$lib/session.svelte';
  import { welcome } from '$lib/copyintent.svelte';
  import { saveForNewDevices, setupVisit } from '$lib/saved-display.svelte';

  type Setting = 'appearance' | 'theme' | 'fonts' | 'reading';
  /** Where setup is: the saved-settings offer, import, the list, one setting opened from it, or the tour. */
  type View = 'offer' | 'import' | 'list' | Setting | 'tour';

  let dialog = $state<HTMLDialogElement | null>(null);
  let open = $state(false);
  let view = $state<View>('list');
  let withImport = $state(false);
  const SETTINGS: Record<Setting, { title: string; lead: string }> = {
    appearance: { title: 'Light or dark', lead: 'Or match your device' },
    theme: { title: 'Color theme', lead: 'Crisp has the most contrast, the Soft themes the least' },
    fonts: { title: 'Fonts', lead: 'Headlines, text, and the app can each have their own' },
    reading: { title: 'Opening a post', lead: 'Read here or on the post’s own site' }
  };
  const header = $derived(
    view === 'offer' ? { title: 'Use your saved settings?', lead: 'These are the settings you saved on another device' }
    : view === 'import' ? { title: 'Import your feeds', lead: 'Coming from another reader?' }
    : view === 'list' ? { title: 'How thicket looks', lead: 'Change any setting, or keep them as they are' }
    : view === 'tour' ? { title: '', lead: '' }
    : SETTINGS[view]
  );
  /**
   * The tour. Each screen starts with the menu item it's about, drawn as the
   * menu draws it, so people can find it again; the headline says why it
   * matters and the line under it how to use it.
   */
  const INTRO = [
    { key: 'intro-new', items: [{ icon: MENU_ICONS.everything, label: 'New posts' }], title: 'Everything you follow, in order', lead: 'Every post from every feed, newest first. No algorithm decides what you see, so nothing gets buried.' },
    { key: 'intro-feeds', items: [{ icon: MENU_ICONS.addFeed, label: 'Add new feed', accent: true }, { icon: MENU_ICONS.explore, label: 'Explore' }], title: 'Bring in the sites you love', lead: 'Already know a site? Add it with its web address. Looking for something new? Explore to see what other readers here follow.' },
    { key: 'intro-bookmarks', items: [{ icon: MENU_ICONS.bookmarks, label: 'Bookmarks' }], title: 'Keep what’s worth coming back to', lead: 'Bookmark a post to save it for later, and add a note with your thoughts. You choose who sees your notes.' },
    { key: 'intro-collections', items: [{ icon: MENU_ICONS.collections, label: 'Collections' }], title: 'Read one topic at a time', lead: 'Group your feeds into collections, like Cooking or Tech, and read just that topic. Share a collection, and others can copy it to follow the same feeds.' },
    { key: 'intro-profile', items: [{ icon: MENU_ICONS.profile, label: 'Profile' }], title: 'Your corner of thicket', lead: 'This is the page other people see. You decide who sees each part of it: anyone, people you follow, or only you.' }
  ];
  let tourStep = $state(0);
  const scene = $derived(INTRO[tourStep]);
  const touring = $derived(view === 'tour');
  const lastScene = $derived(tourStep === INTRO.length - 1);
  /** The tour shows once per account: decided when setup opens, so recording it partway can't reshuffle the steps. */
  let withTour = $state(false);
  /**
   * Skip the list: a device that's already set up opening for an account that
   * hasn't seen the tour, or one that just took on its saved settings. Only
   * import (if it applies) and the tour are left.
   */
  let tourOnly = $state(false);
  /** The account's saved settings, as offered when setup opened. */
  let offered = $state<Display | null>(null);
  let nextButton = $state<HTMLElement | null>(null);
  let heading = $state<HTMLElement | null>(null);
  let rows = $state<HTMLElement | null>(null);
  /** What each setting was when setup opened; a row whose choice differs since gets a check. */
  let initial = $state<Record<string, string>>({});
  /** The setting just closed, so the keyboard lands back on its row. */
  let cameFrom: Setting | null = null;
  // Each new screen moves the keyboard to its heading, or back to the row it came from, or the tour's main button.
  $effect(() => {
    const v = view;
    void tourStep;
    tick().then(() => {
      if (v === 'tour') nextButton?.querySelector('button')?.focus();
      else if (v === 'list' && cameFrom) rows?.querySelector<HTMLElement>(`[data-key="${cameFrom}"]`)?.focus();
      else heading?.focus();
    });
  });
  /** A file has been read, so leaving setup leads to its review. */
  const importing = $derived(withImport && imp.step === 'review');

  // Setup opens on a device that's never been set up, and also for an account
  // that hasn't seen the tour: display settings belong to the device, so a
  // second account made on a set-up device would otherwise never get it.
  onMount(() => { if (!display.configured || (session.user && !session.user.tourSeenAt)) start(); });

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
    starting = true;
    setupVisit.opened = true;
    tourStep = 0;
    cameFrom = null;
    // ?setup in development always includes the tour, also when it's this
    // device's real first setup (a new dev port is a new device to the browser).
    withTour = again || (import.meta.env.DEV && page.url.searchParams.has('setup')) || !session.user?.tourSeenAt;
    offered = !again && !display.configured ? session.user?.savedDisplay ?? null : null;
    tourOnly = !again && display.configured && withTour;
    // Saved settings wait for an answer before the device counts as set up:
    // closing the window on that question asks it again next time, rather
    // than leaving this device on the defaults for good.
    if (!offered) markConfigured();
    initial = Object.fromEntries(describeDisplay(display).map((r) => [r.key, r.value]));
    welcome.open = true;
    // Ask about importing on a new account, or when nothing is followed yet.
    // If that can't be found out, the dialog opens without it rather than not at all.
    const created = session.user ? new Date(session.user.createdAt).getTime() : 0;
    const newAccount = Date.now() - created < 24 * 60 * 60 * 1000;
    api.riverStats()
      .then((s) => { withImport = newAccount || s.feeds === 0; })
      .catch(() => {})
      .finally(() => {
        starting = false;
        view = offered ? 'offer' : withImport ? 'import' : tourOnly ? 'tour' : 'list';
        open = true;
        api.event('display_setup_shown', { withImport, offered: !!offered, tourOnly });
        queueMicrotask(() => { dialog?.showModal(); heading?.focus(); });
      });
  }

  /** Yes to the saved settings: take them on, and skip the list. */
  function useOffered() {
    useDisplay(offered);
    api.event('display_offer_answered', { use: true });
    tourOnly = true;
    if (withImport) view = 'import';
    else afterImport();
  }

  function declineOffered() {
    api.event('display_offer_answered', { use: false });
    markConfigured();
    view = withImport ? 'import' : 'list';
  }

  /** On from import: the list, or straight to the tour (or out) when the list is skipped. */
  function afterImport() {
    if (!tourOnly) view = 'list';
    else if (withTour) view = 'tour';
    else finish('done');
  }

  /** On from the list: the tour if it's owed, otherwise out. */
  function afterList() {
    if (withTour) view = 'tour';
    else finish('done');
  }

  function openSetting(key: Setting) { cameFrom = null; view = key; }
  function closeSetting() { cameFrom = view as Setting; view = 'list'; }

  function finish(how: 'done' | 'dismissed' | 'advanced', skipped = false) {
    const intro = !withTour ? 'already seen' : !touring ? 'not reached' : skipped ? 'skipped' : lastScene && how !== 'dismissed' ? 'finished' : 'left';
    api.event('display_setup_closed', { how, step: touring ? scene.key : view, withImport, importing, intro });
    // Reaching the tour and leaving it any way at all counts as seeing it.
    if (touring && session.user && !session.user.tourSeenAt) {
      session.user.tourSeenAt = new Date().toISOString();
      authApi.tourSeen();
    }
    // A new account's first setup becomes its saved settings, however it ends.
    if (session.user?.saveFirstDisplay && !session.user.savedDisplay) void saveForNewDevices('setup', { quiet: true });
    open = false;
    welcome.open = false;
    welcome.copied = null;
    dialog?.close();
    // Once a file has been picked, every way out leads to choosing its feeds,
    // even while it's still being read: the import page picks up the reading
    // and shows the feeds when it finishes.
    if (importing || (withImport && imp.busy)) void goto('/import');
    else if (how === 'advanced') void goto('/settings#display');
  }
</script>

{#if open}
  <dialog bind:this={dialog} onclose={() => { if (open) finish('dismissed'); }} onclick={(e) => { if (e.target === dialog) finish('dismissed'); }} aria-labelledby="setup-title">
    <div class="box" class:tour={touring}>
      {#if touring}
        <div class="stage" aria-hidden="true">
          {#key scene.key}
            <div class="scene">
              {#if scene.key === 'intro-new'}<NewPostsScene />
              {:else if scene.key === 'intro-feeds'}<FeedsScene />
              {:else if scene.key === 'intro-bookmarks'}<BookmarksScene />
              {:else if scene.key === 'intro-collections'}<CollectionsScene />
              {:else}<ProfileScene />{/if}
            </div>
          {/key}
        </div>
        <div class="words" aria-live="polite">
          {#key scene.key}
            <div class="enter">
              <p class="items">
                {#each scene.items as m (m.label)}
                  <span class="item" class:accent={m.accent}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width={m.accent ? 1.5 : 2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={m.icon} /></svg>{m.label}</span>
                {/each}
              </p>
              <h2 id="setup-title">{scene.title}</h2>
              <p class="lead">{scene.lead}</p>
            </div>
          {/key}
        </div>
        <footer class="tourfoot">
          <span class="skip">{#if !lastScene}<button type="button" class="link" onclick={() => finish('done', true)}>Skip this tour</button>{/if}</span>
          <span class="dots">
            {#each INTRO as s, i (s.key)}
              <button type="button" class="dot" class:on={tourStep === i} aria-label={s.items.map((m) => m.label).join(' and ')} aria-current={tourStep === i ? 'step' : undefined} onclick={() => (tourStep = i)}></button>
            {/each}
          </span>
          <span class="go" bind:this={nextButton}>
            {#if !lastScene}
              <Button variant="primary" onclick={() => tourStep++}>Next</Button>
            {:else}
              <Button variant="primary" onclick={() => finish('done')}>{importing ? 'Review your feeds' : 'Start reading'}</Button>
            {/if}
          </span>
        </footer>
      {:else}
      <header>
        {#if welcome.copied && (view === 'import' || (view === 'list' && !withImport))}<div class="copied"><Banner tone="success" title="Copied “{welcome.copied}” to your collections" /></div>{/if}
        {#if view !== 'offer'}<p class="eyebrow">{withImport ? 'Get started' : 'Set up this device'}</p>{/if}
        <h2 id="setup-title" tabindex="-1" bind:this={heading}>{header.title}</h2>
        <p class="lead">{header.lead}</p>
      </header>

      <div class="body">
        {#if view === 'offer' && offered}
          <div class="rows">
            {#each describeDisplay(offered) as r (r.key)}<SettingRow label={r.label} value={r.value} />{/each}
          </div>
        {:else if view === 'import'}
          {#if importing && imp.preview}
            {@const feeds = new Set(imp.groups.flatMap((g) => g.feeds.map((f) => f.url))).size}
            <div class="found" role="status">
              <Icon name="check" size={22} />
              <div>
                <p class="count">{feeds} {feeds === 1 ? 'feed' : 'feeds'} in {imp.groups.length} {imp.groups.length === 1 ? 'folder' : 'folders'}</p>
                <p class="then">You’ll choose which to bring in at the end</p>
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
        {/if}
        {#if importing && imp.checking && view !== 'import'}<p class="status" aria-live="polite">Checking your feeds</p>{/if}
      </div>

      <footer>
        {#if view !== 'import' && view !== 'offer'}<button type="button" class="link" onclick={() => finish('advanced')}>Advanced options</button>{/if}
        <span class="spacer"></span>
        {#if view === 'offer'}
          <Button onclick={declineOffered}>Set up this device</Button>
          <Button variant="primary" onclick={useOffered}>Use these</Button>
        {:else if view === 'import'}
          <Button variant={importing ? 'primary' : 'ghost'} onclick={afterImport}>{importing ? 'Next' : 'Skip'}</Button>
        {:else if view === 'list'}
          {#if withImport}<Button onclick={() => { cameFrom = null; view = 'import'; }}>Back</Button>{/if}
          <Button variant="primary" onclick={afterList}>{withTour ? 'Next' : importing ? 'Review your feeds' : 'Start reading'}</Button>
        {:else}
          <Button variant="primary" onclick={closeSetting}>Back</Button>
        {/if}
      </footer>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  .box {
    position: fixed; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column;
    background: var(--surface); color: var(--text); border-radius: var(--radius-lg) var(--radius-lg) 0 0; max-height: 92vh;
    box-shadow: var(--shadow-sheet); border: var(--card-border, 0);
  }
  @media (min-width: 700px) {
    .box { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: min(720px, calc(100vw - 48px)); border-radius: var(--radius-lg); max-height: calc(100vh - 48px); }
  }
  header { padding: var(--space-5) var(--space-5) 0; }
  .copied { margin-bottom: var(--space-4); }
  .eyebrow { margin: 0 0 var(--space-1); font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-2); font-weight: 600; }
  h2:focus { outline: none; }
  .rows { display: flex; flex-direction: column; }
  h2 { margin: 0; font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.2; }
  .lead { margin: var(--space-1) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); max-width: 56ch; }
  .body { padding: var(--space-4) var(--space-5) var(--space-1); overflow-y: auto; min-height: 0; }
  footer { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-4) var(--space-5) calc(var(--space-4) + var(--safe-b)); border-top: 1px solid var(--line); margin-top: var(--space-3); }
  .found { display: flex; gap: var(--space-3); align-items: flex-start; color: var(--accent); }
  .found p { margin: 0; }
  /* 4px lines the check up with the middle of the first line, an optical nudge. */
  .found :global(svg) { flex: none; margin-top: 4px; }
  .count { font-size: calc(var(--text-lg) * var(--size-app)); font-weight: 600; color: var(--text); }
  .found .then { margin-top: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .status { margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .spacer { flex: 1; }

  /* The tour: the window grows, and a stage for the picture fills its top. */
  .box { transition: width 450ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  @media (min-width: 700px) { .box.tour { width: min(800px, calc(100vw - 48px)); } }
  .stage {
    position: relative; flex: none; height: clamp(190px, 36vh, 300px); overflow: hidden;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 16%, var(--surface-2)), var(--surface-2));
    border-bottom: 1px solid var(--line);
    animation: stage 500ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }
  @keyframes stage { from { height: 0; } }
  /* The picture fades out at the bottom edge rather than being cut off. */
  .scene { position: absolute; inset: 0; mask-image: linear-gradient(to bottom, #000 70%, transparent); animation: scene 420ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
  @keyframes scene { from { opacity: 0; transform: translateX(28px); } }
  .words { padding: var(--space-5) var(--space-5) 0; min-height: 0; overflow-y: auto; }
  .enter { animation: words 380ms ease-out 80ms backwards; }
  @keyframes words { from { opacity: 0; transform: translateY(6px); } }
  /* The menu item a screen is about, as a small label in the menu's own icon and words. */
  .items { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 var(--space-3); }
  .item {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px var(--space-3) 4px var(--space-2);
    border-radius: var(--radius-pill); background: var(--surface-2); border: var(--card-border, 0);
    font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text);
  }
  .item svg { color: var(--text-2); }
  .item.accent, .item.accent svg { color: var(--accent); }
  .words .lead { font-size: calc(var(--text-base) * var(--size-app)); margin-top: var(--space-2); line-height: 1.45; }
  .tourfoot { display: grid; grid-template-columns: 1fr auto 1fr; border-top: 0; }
  .tourfoot .go { justify-self: end; }
  /* Holds the row's height when the last screen drops Skip this tour, so the window doesn't shift. */
  .tourfoot .skip { min-height: 44px; display: flex; align-items: center; }
  /* A wide window has room to show the pictures a size up. */
  @media (min-width: 700px) { .scene { zoom: 1.2; } }
  .dots { display: flex; align-items: center; }
  /* Each dot is a 44px-tall tap area with the small mark drawn in its middle, so a thumb can hit it. */
  footer .dot {
    display: grid; place-items: center; min-width: 20px; height: 44px; padding: 0 3px; border: 0; border-radius: 0; background: none;
  }
  footer .dot::before {
    content: ''; width: 8px; height: 8px; border-radius: 4px; background: var(--text-3);
    transition: width 300ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 300ms;
  }
  footer .dot.on::before { width: 22px; background: var(--accent); }
  footer .dot:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; border-radius: var(--radius-sm); }
  footer button { padding: var(--space-3) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--line); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); background: var(--surface); }
  footer button.link { border: 0; padding: var(--space-3) var(--space-1); color: var(--accent); }
  footer button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
