<script lang="ts">
  /**
   * First time on a new screen: four short steps that set how thicket looks
   * here. Light or dark, color theme, fonts, then how a post opens. The theme
   * gets its own step so a reader who needs Crisp or a Soft theme
   * meets it on day one, not buried in Settings. Every choice applies as it
   * is made, so the page behind the dialog is the preview. Opening the dialog
   * writes this screen's record, which is what makes it a once-only thing:
   * closing it any way at all is the same as finishing it. The full set of
   * options stays on the Settings page.
   *
   * A new account (under a day old), or anyone who follows nothing yet, gets
   * an import step first, because bringing their feeds is the thing that
   * matters most on day one and it shouldn't wait behind four appearance
   * questions. A new account counts even if it already follows feeds: one
   * shared collection copied on sign-up says nothing about the reader they
   * came from. When that copy is what brought them, the first step says so
   * at the top, and the page behind is their copy. Picking a file says what
   * was found, then the appearance steps go by while the feeds are checked in
   * the background, and the last step opens the review instead of starting to
   * read. The
   * dialog opens once per screen, not per account, so a second device a day
   * or more later only asks when there is still nothing followed.
   *
   * After the questions, the window grows and turns into a short tour of how
   * thicket works: one screen per thing in the menu, each with a picture of
   * it that plays on a loop. Skip this tour leaves from any of them and
   * lands where the last one would.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { display, markConfigured, setDisplay, APPEARANCES, READING_MODES } from '$lib/display.svelte';
  import Tiles from './Tiles.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import FontTable from './FontTable.svelte';
  import { appearanceArt, READING_ART } from './art';
  import Button from '$lib/components/Button.svelte';
  import ImportHelp from '$lib/components/ImportHelp.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import { MENU_ICONS } from '$lib/menu-icons';
  import NewPostsScene from '$lib/components/intro/NewPostsScene.svelte';
  import FeedsScene from '$lib/components/intro/FeedsScene.svelte';
  import BookmarksScene from '$lib/components/intro/BookmarksScene.svelte';
  import CollectionsScene from '$lib/components/intro/CollectionsScene.svelte';
  import ProfileScene from '$lib/components/intro/ProfileScene.svelte';
  import { imp } from '$lib/importer.svelte';
  import { session } from '$lib/session.svelte';
  import { welcome } from '$lib/copyintent.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);
  let open = $state(false);
  let step = $state(0);
  let withImport = $state(false);
  const IMPORT = { key: 'import', title: 'Import your feeds', lead: 'Coming from another reader?' };
  const DISPLAY = [
    { key: 'appearance', title: 'Light or dark?', lead: 'Pick what suits this screen. You can also let it follow the device’s own setting.' },
    { key: 'theme', title: 'Color theme', lead: 'Pick the colors thicket uses on this screen. Crisp has the most contrast; the Soft themes have the least.' },
    { key: 'fonts', title: 'Fonts', lead: 'Headlines, text and the app itself can each have their own face and size. Watch the page behind this box change.' },
    { key: 'reading', title: 'Opening a post', lead: 'Read here, or on the post’s own site. Sites that only send a preview always get a link out.' }
  ];
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
  const STEPS: { key: string; title: string; lead: string; items?: { icon: string; label: string; accent?: boolean }[] }[] = $derived([...(withImport ? [IMPORT] : []), ...DISPLAY, ...INTRO]);
  const current = $derived(STEPS[step]);
  const touring = $derived(current.key.startsWith('intro-'));
  const tourStart = $derived(STEPS.length - INTRO.length);
  const last = $derived(step === STEPS.length - 1);
  let nextButton = $state<HTMLElement | null>(null);
  // Arriving on a tour screen swaps the footer for the tour's, so keep the keyboard on its main button.
  $effect(() => { if (touring && step >= tourStart) nextButton?.querySelector('button')?.focus(); });
  /** A file has been read, so the last step leads to its review. */
  const importing = $derived(withImport && imp.step === 'review');

  onMount(() => {
    // In development, ?setup opens the walkthrough again on a screen that has already seen it.
    const again = import.meta.env.DEV && new URLSearchParams(location.search).has('setup');
    if (display.configured && !again) return;
    markConfigured();
    welcome.open = true;
    // Ask about importing on a new account, or when nothing is followed yet.
    // If that can't be found out, the dialog opens without it rather than not at all.
    const created = session.user ? new Date(session.user.createdAt).getTime() : 0;
    const newAccount = Date.now() - created < 24 * 60 * 60 * 1000;
    api.riverStats()
      .then((s) => { withImport = newAccount || s.feeds === 0; })
      .catch(() => {})
      .finally(() => {
        open = true;
        api.event('display_setup_shown', { withImport });
        queueMicrotask(() => dialog?.showModal());
      });
  });

  /** Leave the tour, finished or skipped, for wherever the last step goes. */
  const leave = (skipped: boolean) => finish(importing ? 'review' : 'done', skipped);

  function finish(how: 'done' | 'dismissed' | 'advanced' | 'review', skipped = false) {
    const intro = !touring ? 'not reached' : skipped ? 'skipped' : last && how !== 'dismissed' ? 'finished' : 'left';
    api.event('display_setup_closed', { how, step: current.key, withImport, intro });
    open = false;
    welcome.open = false;
    welcome.copied = null;
    dialog?.close();
    if (how === 'advanced') void goto('/settings#display');
    if (how === 'review') void goto('/import');
  }
</script>

{#if open}
  <dialog bind:this={dialog} onclose={() => { if (open) finish('dismissed'); }} onclick={(e) => { if (e.target === dialog) finish('dismissed'); }} aria-labelledby="setup-title">
    <div class="box" class:tour={touring}>
      {#if touring}
        <div class="stage" aria-hidden="true">
          {#key current.key}
            <div class="scene">
              {#if current.key === 'intro-new'}<NewPostsScene />
              {:else if current.key === 'intro-feeds'}<FeedsScene />
              {:else if current.key === 'intro-bookmarks'}<BookmarksScene />
              {:else if current.key === 'intro-collections'}<CollectionsScene />
              {:else}<ProfileScene />{/if}
            </div>
          {/key}
        </div>
        <div class="words" aria-live="polite">
          {#key current.key}
            <div class="enter">
              <p class="items">
                {#each current.items ?? [] as m (m.label)}
                  <span class="item" class:accent={m.accent}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width={m.accent ? 1.5 : 2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={m.icon} /></svg>{m.label}</span>
                {/each}
              </p>
              <h2 id="setup-title">{current.title}</h2>
              <p class="lead">{current.lead}</p>
            </div>
          {/key}
        </div>
        <footer class="tourfoot">
          <span class="skip">{#if !last}<button type="button" class="link" onclick={() => leave(true)}>Skip this tour</button>{/if}</span>
          <span class="dots">
            {#each INTRO as s, i (s.key)}
              <button type="button" class="dot" class:on={step === tourStart + i} aria-label={s.items.map((m) => m.label).join(' and ')} aria-current={step === tourStart + i ? 'step' : undefined} onclick={() => (step = tourStart + i)}></button>
            {/each}
          </span>
          <span class="go" bind:this={nextButton}>
            {#if !last}
              <Button variant="primary" onclick={() => step++}>Next</Button>
            {:else}
              <Button variant="primary" onclick={() => leave(false)}>{importing ? 'Review your feeds' : 'Start reading'}</Button>
            {/if}
          </span>
        </footer>
      {:else}
      <header>
        {#if welcome.copied && step === 0}<div class="copied"><Banner tone="success" title="Copied “{welcome.copied}” to your collections" /></div>{/if}
        <p class="eyebrow">{withImport ? 'Get started' : 'Set up this screen'} · {step + 1} of {STEPS.length}</p>
        <h2 id="setup-title">{current.title}</h2>
        <p class="lead">{current.lead}</p>
      </header>

      <div class="body">
        {#if current.key === 'import'}
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
        {:else if current.key === 'appearance'}
          <Tiles name="Appearance" options={APPEARANCES} value={display.appearance} art={appearanceArt(display.palette, display.accent)} onchange={(v) => setDisplay({ appearance: v })} />
        {:else if current.key === 'theme'}
          <ThemePicker />
        {:else if current.key === 'fonts'}
          <FontTable compact />
        {:else}
          <Tiles name="Opening a post" options={READING_MODES} value={display.reading} art={READING_ART} notes onchange={(v) => setDisplay({ reading: v })} />
        {/if}
        {#if importing && imp.checking && current.key !== 'import'}<p class="status" aria-live="polite">Checking your feeds</p>{/if}
      </div>

      <footer>
        {#if current.key !== 'import'}<button type="button" class="link" onclick={() => finish('advanced')}>Advanced options</button>{/if}
        <span class="spacer"></span>
        {#if step > 0}<Button onclick={() => step--}>Back</Button>{/if}
        {#if current.key === 'import' && !importing}
          <Button onclick={() => step++}>Skip</Button>
        {:else if step < STEPS.length - 1}
          <Button variant="primary" onclick={() => step++}>Next</Button>
        {:else if importing}
          <Button variant="primary" onclick={() => finish('review')}>Review your feeds</Button>
        {:else}
          <Button variant="primary" onclick={() => finish('done')}>Start reading</Button>
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
