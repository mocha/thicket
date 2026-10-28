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
   * After the list comes the tour, once per account: the dialog closes and
   * the tour opens by the real menu (Tour.svelte). Setup ends where it would
   * have once the tour closes, however it closes.
   *
   * When more than one of those three applies, setup opens on a welcome that
   * asks about each as a question (THICKET-34): No to the import question to
   * start, since most people aren't moving from another reader, Yes to the rest. Only
   * the ones left at Yes follow, in that order, so what's optional is clear up front.
   * No to the tour counts as seeing it.
   */
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, authApi } from '$lib/api';
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
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import { imp, startOverImport } from '$lib/importer.svelte';
  import { session } from '$lib/session.svelte';
  import { welcome } from '$lib/copyintent.svelte';
  import { saveForNewDevices, setupVisit } from '$lib/saved-display.svelte';
  import { tour } from '$lib/firstrun.svelte';

  type Setting = 'appearance' | 'theme' | 'fonts' | 'reading' | 'layout' | 'fresh';
  /** Where setup is: the welcome, import, the list, or one setting opened from it. */
  type View = 'welcome' | 'import' | 'list' | Setting;
  /** The three parts of setup, in the order they run. */
  type Part = 'import' | 'looks' | 'tour';
  const QUESTIONS: { key: Part; question: string; line: string }[] = [
    { key: 'import', question: 'Moving from Feedly or another reader?', line: 'Import your sites and folders' },
    { key: 'looks', question: 'Customize how thicket looks?', line: 'Light or dark mode, colors, fonts, and more' },
    { key: 'tour', question: 'Want a quick tour?', line: 'We’ll show you how thicket works' }
  ];
  const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  /** The welcome's answers: No to importing to start, Yes to the rest. Only parts answered Yes run. */
  let want = $state<Record<Part, boolean>>({ import: false, looks: true, tour: true });
  /** Whether this visit asks the welcome's questions at all: more than one part applies. */
  let asked = $state(false);

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
  /** The tour shows once per account: decided when setup opens, so recording it partway can't reshuffle the steps. */
  let withTour = $state(false);
  /**
   * Skip the list: a device that's already set up opening for an account that
   * hasn't seen the tour. Only import (if it applies) and the tour are left.
   */
  let tourOnly = $state(false);
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
    view === 'import' ? { title: 'Import your feeds', lead: '' }
    : view === 'welcome' ? { title: 'Welcome to thicket', lead: 'Answer a few questions to make it yours' }
    : view === 'list' ? { title: 'Customize how thicket looks', lead: fromSaved ? 'These are the settings you saved on another device' : 'You can update your choices at any time in Settings' }
    : SETTINGS[view]
  );

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
    cameFrom = null;
    // ?setup in development always includes import and the tour, also when it's
    // this device's real first setup (a new dev port is a new device to the
    // browser), so the whole walkthrough can be reviewed on any account.
    // Signing in starts setup while still on the sign-in page, so ?setup can
    // be inside the address it's about to go to.
    const review = again || (import.meta.env.DEV && (page.url.searchParams.has('setup') || /[?&]setup\b/.test(page.url.searchParams.get('next') ?? '')));
    withTour = review || !session.user?.tourSeenAt;
    const saved = !again && !display.configured ? session.user?.savedDisplay ?? null : null;
    fromSaved = !!saved;
    tourOnly = !review && display.configured && withTour;
    want = { import: false, looks: true, tour: true };
    if (saved) useDisplay(saved);
    else markConfigured();
    initial = Object.fromEntries(describeDisplay(display).map((r) => [r.key, r.value]));
    welcome.open = true;
    // Ask about importing on a new account, or when nothing is followed yet.
    // If that can't be found out, the dialog opens without it rather than not at all.
    const created = session.user ? new Date(session.user.createdAt).getTime() : 0;
    const newAccount = Date.now() - created < 24 * 60 * 60 * 1000;
    api.riverStats()
      .then((s) => { withImport = review || newAccount || s.feeds === 0; })
      .catch(() => {})
      .finally(() => {
        starting = false;
        api.event('display_setup_shown', { withImport, fromSaved, tourOnly });
        // Only the tour left: no dialog, straight to it.
        if (tourOnly && !withImport) return finish('done');
        asked = parts().length > 1;
        view = asked ? 'welcome' : withImport ? 'import' : 'list';
        open = true;
        queueMicrotask(() => { dialog?.showModal(); heading?.focus(); });
      });
  }

  /** The parts this visit has, before any are answered No. */
  function parts(): Part[] {
    return QUESTIONS.map((q) => q.key).filter((k) => k === 'import' ? withImport : k === 'looks' ? !tourOnly : withTour);
  }
  /** The parts that run: all of them, or the ones answered Yes when the welcome asked. */
  const running = () => parts().filter((k) => !asked || want[k]);

  /** On to the next part that runs after `from` (the welcome when null), or out. The tour is last, and runs as setup closes. */
  function onFrom(from: Part | null) {
    const rest = running();
    const next = rest[from ? rest.indexOf(from) + 1 : 0];
    if (next === 'import') view = 'import';
    else if (next === 'looks') view = 'list';
    else finish('done');
  }
  /** Back from a part: the one before it, or the welcome. */
  function backFrom(from: Part) {
    const rest = running();
    const prev = rest[rest.indexOf(from) - 1];
    cameFrom = null;
    view = prev === 'import' ? 'import' : asked ? 'welcome' : view;
  }
  /** Moving on from this part ends setup (the tour, if it runs, opens as setup closes). */
  const endsSetup = (p: Part) => { const r = running(); return r[r.length - 1] === p; };

  /** What the open setting was when it opened: once it changes, the footer says it's saved (it saves as it's picked). */
  let openedAt = $state('');
  const current = (key: string) => describeDisplay(display).find((r) => r.key === key)?.value ?? '';
  function openSetting(key: Setting) { cameFrom = null; openedAt = current(key); view = key; }
  function closeSetting() { cameFrom = view as Setting; view = 'list'; }

  /**
   * Out of the dialog. Moving on from the last screen goes to the tour when
   * it's owed; closing the dialog any other way skips it for now (it's
   * offered again next time, as setup is). Setup ends where it would have
   * once the tour closes.
   */
  function finish(how: 'done' | 'dismissed') {
    const toTour = how === 'done' && withTour && (!asked || want.tour);
    api.event('display_setup_closed', { how, step: view, withImport, importing, toTour, ...(asked ? { want } : {}) });
    // Answering no to the tour is the same as seeing it, however setup closes: it doesn't come back.
    const me = session.user;
    if (asked && withTour && !want.tour && me && !me.tourSeenAt) {
      me.tourSeenAt = new Date().toISOString();
      authApi.tourSeen();
    }
    // A new account's first setup becomes its saved settings, however it ends.
    // So does an older account's first device since saved settings existed.
    const u = session.user;
    if (u && !u.savedDisplay) {
      if (u.saveFirstDisplay) void saveForNewDevices('setup', { quiet: true });
      else if (!u.displayOfferAnsweredAt) void saveForNewDevices('first-device', { quiet: true });
    }
    // Read before it's cleared: a copy made on arrival decides where this ends.
    const copiedOnArrival = !!welcome.copied;
    open = false;
    welcome.open = false;
    welcome.copied = null;
    dialog?.close();
    const toImport = importing || (withImport && imp.busy);
    const end = () => {
      // Once a file has been picked, every way out leads to choosing its feeds,
      // even while it's still being read: the import page picks up the reading
      // and shows the feeds when it finishes.
      if (toImport) void goto('/import');
      // A first setup that didn't import ends where a new person can find
      // something to read: Explore's Collections, every public collection with
      // Copy on its row. Unless a shared copy link just gave them one, in which
      // case Collections, with the copy in the list.
      else if (withImport) void goto(copiedOnArrival ? '/collections' : '/explore?scope=collections');
    };
    if (!toTour) return end();
    tour.done = toImport ? 'Review your feeds' : 'Start reading';
    tour.after = end;
    tour.open = true;
  }
</script>

{#if open}
  <dialog bind:this={dialog} onclose={() => { if (open) finish('dismissed'); }} aria-labelledby="setup-title">
    <div class="box" class:forest={view === 'welcome'}>
      {#if view === 'welcome'}{#await import('./WelcomeFronds.svelte') then m}<m.default />{/await}{/if}
      <div class="panel">
      <header class:over={view === 'welcome'}>
        {#if welcome.copied && (view === 'welcome' || (!asked && (view === 'import' || (view === 'list' && !withImport))))}<div class="copied"><Banner tone="success" title="Copied “{welcome.copied}” to your collections" /></div>{/if}
        <h2 id="setup-title" tabindex="-1" bind:this={heading}>{header.title}</h2>
        {#if header.lead}<p class="lead">{header.lead}</p>{/if}
      </header>

      <div class="body" class:over={view === 'welcome'}>
        {#if view === 'welcome'}
          <div class="rows">
            {#each QUESTIONS.filter((q) => parts().includes(q.key)) as q (q.key)}
              <div class="ask">
                <span class="text"><span class="q" id="ask-{q.key}">{q.question}</span><span class="line">{q.line}</span></span>
                <ChoiceGroup size="sm" options={YES_NO} value={want[q.key] ? 'yes' : 'no'} onchange={(v) => (want[q.key] = v === 'yes')} label={q.question} />
              </div>
            {/each}
          </div>
        {:else if view === 'import'}
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

      <footer class:over={view === 'welcome'}>
        <span class="spacer"></span>
        <!-- Always there, so a screen reader hears "Saved" when it fills in. -->
        <span class="saved" role="status">{#if view in SETTINGS && current(view) !== openedAt}<Icon name="check" size={16} />Saved{/if}</span>
        {#if view === 'welcome'}
          <Button variant="primary" size="lg" onclick={() => onFrom(null)}>{running().length ? 'Let’s get started' : 'Start reading'}</Button>
        {:else if view === 'import'}
          {#if asked}<Button onclick={() => backFrom('import')}>Back</Button>{/if}
          <Button variant={importing ? 'primary' : 'ghost'} onclick={() => onFrom('import')}>{importing ? 'Next' : 'Skip this step'}</Button>
        {:else if view === 'list'}
          {#if asked || withImport}<Button onclick={() => backFrom('looks')}>Back</Button>{/if}
          <Button variant="primary" onclick={() => onFrom('looks')}>{!endsSetup('looks') ? 'Next' : importing ? 'Review your feeds' : 'Start reading'}</Button>
        {:else}
          <Button variant="primary" onclick={closeSetting}>Back</Button>
        {/if}
      </footer>
      </div>
    </div>
  </dialog>
{/if}

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  /* Behind every setup screen, the page is blurred so it reads as a backdrop, not something to read. */
  dialog::backdrop { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
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
  /* Every screen but the welcome lays its parts straight into the window. */
  .panel { display: contents; }
  /* The welcome: the landing page's forest green around the window's edge,
     fronds growing in from all sides (WelcomeFronds), and the questions on a
     panel in front. */
  .box.forest { padding: 56px 72px; background: #15291c; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35); }
  .forest .panel {
    display: flex; flex-direction: column; position: relative; min-height: 0;
    background: var(--surface); border-radius: var(--radius-lg); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
  /* On a phone the welcome fills the screen, the green all around and the questions in the middle. */
  @media (max-width: 699px) {
    .box.forest {
      top: 0; max-height: none; border-radius: 0; display: grid; place-items: center; overflow-y: auto;
      padding: calc(var(--space-5) + env(safe-area-inset-top, 0px)) var(--space-4) calc(var(--space-5) + var(--safe-b));
    }
    .forest .panel { width: 100%; }
  }
  .over { position: relative; }
  /* The welcome is centered: its heading and line, and the questions in a
     narrow column, so each question sits close to its Yes or No and the
     corners are left to the fronds. */
  header.over { text-align: center; }
  header.over .lead { margin-inline: auto; }
  .body.over .rows { max-width: 440px; margin-inline: auto; }
  /* No line above the welcome's button, which sits centered under the questions. */
  footer.over { border-top: 0; justify-content: center; padding-bottom: var(--space-5); }
  footer.over .spacer { display: none; }
  /* A welcome question: the question in bold with its line under it in gray, and Yes or No at the row's right end. */
  .ask { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid var(--line); }
  .ask:last-child { border-bottom: 0; }
  .ask .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ask .q { font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); color: var(--text); }
  .ask .line { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
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
  .saved { display: inline-flex; align-items: center; gap: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .saved :global(svg) { color: var(--accent); }
  .saved:not(:empty) { margin-right: var(--space-2); }
</style>
