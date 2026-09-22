<script lang="ts">
  /**
   * First time on a new screen: three short steps that set how thicket looks
   * here. Appearance, fonts, then how a post opens. Every choice applies as it
   * is made, so the page behind the dialog is the preview. Opening the dialog
   * writes this screen's record, which is what makes it a once-only thing:
   * closing it any way at all is the same as finishing it. The full set of
   * options stays on the Settings page.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { display, markConfigured, setDisplay, APPEARANCES, READING_MODES } from '$lib/display.svelte';
  import Tiles from './Tiles.svelte';
  import FontTable from './FontTable.svelte';
  import { APPEARANCE_ART, READING_ART } from './art';
  import Button from '$lib/components/Button.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);
  let open = $state(false);
  let step = $state(0);
  const STEPS = [
    { title: 'Light or dark?', lead: 'Pick what suits this screen. You can also let it follow the device’s own setting.' },
    { title: 'Fonts', lead: 'Headlines, text and the app itself can each have their own face and size. Watch the page behind this box change.' },
    { title: 'Opening a post', lead: 'Read here, or on the post’s own site. Sites that only send a preview always get a link out.' }
  ];

  onMount(() => {
    if (display.configured) return;
    open = true;
    markConfigured();
    api.event('display_setup_shown');
    queueMicrotask(() => dialog?.showModal());
  });

  function finish(how: 'done' | 'dismissed' | 'advanced') {
    api.event('display_setup_closed', { how, step });
    open = false;
    dialog?.close();
    if (how === 'advanced') void goto('/settings#display');
  }
</script>

{#if open}
  <dialog bind:this={dialog} onclose={() => { if (open) finish('dismissed'); }} onclick={(e) => { if (e.target === dialog) finish('dismissed'); }} aria-labelledby="setup-title">
    <div class="box">
      <header>
        <p class="eyebrow">Set up this screen · {step + 1} of {STEPS.length}</p>
        <h2 id="setup-title">{STEPS[step].title}</h2>
        <p class="lead">{STEPS[step].lead}</p>
      </header>

      <div class="body">
        {#if step === 0}
          <Tiles name="Appearance" options={APPEARANCES} value={display.appearance} art={APPEARANCE_ART} onchange={(v) => setDisplay({ appearance: v })} />
        {:else if step === 1}
          <FontTable compact />
        {:else}
          <Tiles name="Opening a post" options={READING_MODES} value={display.reading} art={READING_ART} notes onchange={(v) => setDisplay({ reading: v })} />
        {/if}
      </div>

      <footer>
        <button type="button" class="link" onclick={() => finish('advanced')}>Advanced options</button>
        <span class="spacer"></span>
        {#if step > 0}<Button onclick={() => step--}>Back</Button>{/if}
        {#if step < STEPS.length - 1}
          <Button variant="primary" onclick={() => step++}>Next</Button>
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
  .eyebrow { margin: 0 0 var(--space-1); font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); font-weight: 600; }
  h2 { margin: 0; font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.2; }
  .lead { margin: var(--space-1) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); max-width: 56ch; }
  .body { padding: var(--space-4) var(--space-5) var(--space-1); overflow-y: auto; min-height: 0; }
  footer { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-4) var(--space-5) calc(var(--space-4) + var(--safe-b)); border-top: 1px solid var(--line); margin-top: var(--space-3); }
  .spacer { flex: 1; }
  footer button { padding: var(--space-3) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--line); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); background: var(--surface); }
  footer button.link { border: 0; padding: var(--space-3) var(--space-1); color: var(--accent); }
  footer button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
