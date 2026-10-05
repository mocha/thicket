<script lang="ts">
  /**
   * First time in: four short steps that set how thicket looks, on every
   * device. Light or dark, color theme, fonts, then how a post opens. The theme
   * gets its own step so a reader who needs Crisp or a Soft theme
   * meets it on day one, not buried in Settings. Every choice applies as it
   * is made, so the page behind the dialog is the preview. Opening the dialog
   * writes the account's record, which is what makes it a once-only thing:
   * closing it any way at all is the same as finishing it, and another device
   * signing in later finds the record and never asks. Anyone happy with what
   * they see can accept the rest as it stands and skip the remaining steps.
   * The full set of options stays on the Settings page.
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
   * read.
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
  import { imp } from '$lib/importer.svelte';
  import { session } from '$lib/session.svelte';
  import { welcome } from '$lib/copyintent.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);
  let open = $state(false);
  let step = $state(0);
  let withImport = $state(false);
  const IMPORT = { key: 'import', title: 'Import your feeds', lead: 'Coming from another reader?' };
  const DISPLAY = [
    { key: 'appearance', title: 'Light or dark?', lead: 'Pick what suits you. You can also let each device follow its own setting.' },
    { key: 'theme', title: 'Color theme', lead: 'Pick the colors thicket uses. Crisp has the most contrast; the Soft themes have the least.' },
    { key: 'fonts', title: 'Fonts', lead: 'Headlines, text and the app itself can each have their own face and size. Watch the page behind this box change.' },
    { key: 'reading', title: 'Opening a post', lead: 'Read here, or on the post’s own site. Sites that only send a preview always get a link out.' }
  ];
  const STEPS = $derived(withImport ? [IMPORT, ...DISPLAY] : DISPLAY);
  const current = $derived(STEPS[step]);
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

  /** `defaults`: keep everything as it stands now and skip the steps left, ending where the last step would. */
  function finish(how: 'done' | 'dismissed' | 'advanced' | 'review' | 'defaults') {
    api.event('display_setup_closed', { how, step: current.key, withImport });
    open = false;
    welcome.open = false;
    welcome.copied = null;
    dialog?.close();
    if (how === 'advanced') void goto('/settings#display');
    if (how === 'review' || (how === 'defaults' && importing)) void goto('/import');
  }
</script>

{#if open}
  <dialog bind:this={dialog} onclose={() => { if (open) finish('dismissed'); }} onclick={(e) => { if (e.target === dialog) finish('dismissed'); }} aria-labelledby="setup-title">
    <div class="box">
      <header>
        {#if welcome.copied && step === 0}<div class="copied"><Banner tone="success" title="Copied “{welcome.copied}” to your collections" /></div>{/if}
        <p class="eyebrow">{withImport ? 'Get started' : 'Set up thicket'} · {step + 1} of {STEPS.length}</p>
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
        <!-- Not on the last step, where the main button already does this, nor before any setting has been shown. -->
        {#if current.key !== 'import' && step < STEPS.length - 1}
          <p class="accept">Like what you see? <button type="button" class="link" onclick={() => finish('defaults')}>Accept the defaults</button></p>
        {/if}
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
  .accept { margin: var(--space-4) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .accept .link { border: 0; padding: var(--space-1) 0; background: none; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; }
  .accept .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .spacer { flex: 1; }
  footer button { padding: var(--space-3) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--line); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); background: var(--surface); }
  footer button.link { border: 0; padding: var(--space-3) var(--space-1); color: var(--accent); }
  footer button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
