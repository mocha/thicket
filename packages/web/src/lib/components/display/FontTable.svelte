<script lang="ts">
  /**
   * Three roles (headlines, text, app), each with a face and a size. The face
   * buttons act as the radio; the size is stepped with − and +. Beside the
   * rows (below them when narrow), a preview shows the three together, since
   * how they hang together is the thing to judge, not any one of them.
   */
  import { display, setFont, stepSize, FAMILIES, ROLES, SIZE_MIN, SIZE_MAX, sizeLabel, type Family, type Role } from '$lib/display.svelte';
  import { api } from '$lib/api';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  function family(role: Role, f: Family) { setFont(role, { family: f }); api.event('display_changed', { key: `font.${role}`, value: f }); }
  /* Each option is set in the face it offers, so the row is its own preview. */
  const FACES = FAMILIES.map((f) => ({ value: f.id, label: f.label, data: { 'data-face': f.id } }));
  function step(role: Role, d: 1 | -1) { stepSize(role, d); api.event('display_changed', { key: `size.${role}`, value: display.fonts[role].size }); }
</script>

<div class="fonts" class:compact>
  <div class="rows">
    {#each ROLES as r (r.id)}
      <div class="row">
        <div class="who"><span>{r.label}</span>{#if !compact}<small>{r.note}</small>{/if}</div>
        <ChoiceGroup
          class="faces"
          options={FACES}
          value={display.fonts[r.id].family}
          label="{r.label} font"
          size="sm"
          onchange={(v) => family(r.id, v as Family)}
        />
        <div class="stepper" role="group" aria-label="{r.label} size">
          <button type="button" onclick={() => step(r.id, -1)} disabled={display.fonts[r.id].size <= SIZE_MIN} aria-label="Smaller {r.label.toLowerCase()}">−</button>
          <output>{sizeLabel(display.fonts[r.id].size)}</output>
          <button type="button" onclick={() => step(r.id, 1)} disabled={display.fonts[r.id].size >= SIZE_MAX} aria-label="Larger {r.label.toLowerCase()}">+</button>
        </div>
      </div>
    {/each}
  </div>

  <div class="preview" aria-hidden="true">
    <span class="tag">Example</span>
    <p class="h">A headline you would stop for</p>
    <p class="t">Whatever you read, it arrives here in order, with nothing in between.</p>
    <span class="btn">Follow</span>
  </div>
</div>

<style>
  /* Side by side only where there is room for it; the settings column is not that wide, a dialog can be. */
  .fonts { container-type: inline-size; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
  @container (min-width: 720px) { .fonts { grid-template-columns: minmax(0, 1fr) 220px; align-items: start; } }
  .rows { display: flex; flex-direction: column; }
  .row { display: grid; grid-template-columns: minmax(84px, 1fr) auto auto; align-items: center; gap: 8px 10px; padding: 9px 0; }
  .row + .row { border-top: 1px solid var(--line); }
  .who { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text); min-width: 0; }
  .who small { font-weight: 400; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); line-height: 1.3; }
  /* The face row sits at the right-hand end, and each option is set in the
     face it offers. OpenDyslexic runs large, so it is knocked down a size. */
  .row :global(.faces) { justify-self: end; }
  .row :global(.faces button[data-face='serif']) { font-family: var(--font-serif); }
  .row :global(.faces button[data-face='dyslexic']) { font-family: var(--font-dyslexic); font-size: calc(var(--text-xs) * var(--size-app)); }
  .stepper button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; position: relative; z-index: 1; }
  .stepper { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; background: var(--bg); justify-self: end; }
  .stepper button { width: 30px; height: 32px; font-size: calc(var(--text-base) * var(--size-app)); color: var(--text-2); }
  .stepper button:disabled { opacity: 0.35; }
  .stepper output { min-width: 5.5ch; text-align: center; font-size: calc(var(--text-sm) * var(--size-app)); font-variant-numeric: tabular-nums; color: var(--text-2); }
  /* Narrow: the name and the size share the first line, and the three faces
     take the whole of the next one, where their names fit at full size. */
  @container (max-width: 479px) {
    .row { grid-template-columns: 1fr auto; }
    .who { grid-column: 1; }
    .who small { display: none; }
    .stepper { grid-column: 2; grid-row: 1; }
    .row :global(.faces) { grid-column: 1 / -1; justify-self: start; }
    .stepper button { width: 26px; }
  }

  /* The preview is set in the live tokens, so it is not a mock-up: it is the app. */
  .preview { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 22px 14px 14px; border-radius: 12px; background: var(--bg); border: 1px dashed var(--text-3); }
  .tag { position: absolute; top: -9px; left: 12px; padding: 1px 8px; border-radius: 999px; background: var(--surface); border: 1px dashed var(--text-3); font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); }
  .preview p { margin: 0; }
  .h { font-family: var(--font-headings); font-weight: 600; font-size: calc(var(--text-xl) * var(--size-headings)); line-height: 1.2; letter-spacing: -0.01em; }
  .t { font-family: var(--font-reading); font-size: calc(var(--text-sm) * var(--size-reading)); line-height: 1.45; color: var(--text-2); }
  .btn { font-family: var(--font); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; padding: 7px 13px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); }
</style>
