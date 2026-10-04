<script lang="ts">
  /**
   * How to get your feeds out of the reader you're leaving, then the button
   * that brings the file in. Feedly hides its export behind an address with
   * no menu leading to it, and Inoreader puts a free export beside a paid
   * backup that says "Pro users only", so each gets its own steps. Everyone
   * else has an export in plain sight and gets one line.
   *
   * The same on the Import page and in the first-run setup, so the steps read
   * the same wherever someone starts.
   */
  import { importApi } from '$lib/api';
  import { imp, readImport } from '$lib/importer.svelte';
  import Tabs from './Tabs.svelte';

  /** `errors` off when the page shows the reading error itself, below other ways in. */
  let { via, errors = true }: { via: string; errors?: boolean } = $props();

  const READERS = [
    { value: 'feedly', label: 'Feedly' },
    { value: 'inoreader', label: 'Inoreader' },
    { value: 'other', label: 'Other' }
  ];
  let reader = $state('feedly');
  let fileInput = $state<HTMLInputElement | null>(null);
  const panel = `import-steps-${Math.random().toString(36).slice(2, 8)}`;

  async function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    await readImport(() => importApi.readFile(file), via);
    if (fileInput) fileInput.value = '';
  }
</script>

<Tabs tabs={READERS} value={reader} onchange={(v) => (reader = v)} label="Your reader" {panel} fill />

<div id={panel} role="tabpanel">
<ol class="steps">
  {#if reader === 'feedly'}
    <li>Go to <a href="https://feedly.com/i/opml" target="_blank" rel="noopener">feedly.com/i/opml</a> (you may need to sign in first)</li>
    <li>Click <em>Download your Feedly OPML</em></li>
  {:else if reader === 'inoreader'}
    <li>Go to <a href="https://www.inoreader.com" target="_blank" rel="noopener">Inoreader</a> (sign in if you aren’t already)</li>
    <li>In the main navigation, click the gear to open your Preferences</li>
    <li>Click <em>Account</em></li>
    <li>Click <em>Export and backup</em> in the top tabs (desktop) or dropdown (mobile)</li>
    <li>Click <em>Download OPML file</em></li>
  {:else}
    <li>Sign into your reader</li>
    <li>Find Export or OPML in its settings</li>
  {/if}
  <li>{#if imp.busy}Reading…{:else}Upload the file <button type="button" class="upload tap" onclick={() => fileInput?.click()}>here</button>{/if}</li>
</ol>
</div>
<input bind:this={fileInput} type="file" accept=".opml,.xml,text/x-opml,text/xml,application/xml" onchange={onFile} hidden />

{#if errors && imp.error}<p class="bad" role="alert">{imp.error}</p>{/if}

<style>
  .steps { margin: var(--space-4) 0 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: var(--space-2); font-size: calc(var(--text-base) * var(--size-app)); color: var(--text); line-height: 1.4; }
  .steps a, .upload { color: var(--accent); font-weight: 600; }
  .steps a { overflow-wrap: anywhere; }
  .upload { padding: 0; border: 0; background: none; font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 0.15em; }
  .upload:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
  .bad { color: var(--danger); margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
