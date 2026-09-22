<script lang="ts">
  /**
   * The thicket design system, shown with the real components and the real
   * tokens. Public at /design-system. Because it renders the same pieces the
   * app is built from, it can never drift from what ships.
   *
   * The palette and light/dark controls at the top set the data-* attributes on
   * <html> directly, the same attributes app.css keys off. That previews a
   * theme without saving it, so a signed-in reader's own choice is left alone:
   * whatever was on the page when they arrived is put back when they leave.
   */
  import { onMount } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import Select from '$lib/components/Select.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Monogram from '$lib/components/Monogram.svelte';
  import { showToast } from '$lib/toast.svelte';

  /* ---- Live theme preview: set <html> attributes, restore on the way out ---- */
  type Appearance = 'system' | 'light' | 'dark';
  let appearance = $state<Appearance>('system');
  let palette = $state('default');
  let accent = $state('blue');

  /* What the page found on <html> when it opened, so it can be put back. */
  let saved: { theme?: string; palette?: string; accent?: string } = {};
  onMount(() => {
    const d = document.documentElement.dataset;
    saved = { theme: d.theme, palette: d.palette, accent: d.accent };
    appearance = (d.theme as Appearance) ?? 'system';
    palette = d.palette ?? 'default';
    accent = d.accent ?? 'blue';
    return () => {
      const set = (k: 'theme' | 'palette' | 'accent', v?: string) => {
        if (v === undefined) delete document.documentElement.dataset[k];
        else document.documentElement.dataset[k] = v;
      };
      set('theme', saved.theme);
      set('palette', saved.palette);
      set('accent', saved.accent);
    };
  });

  $effect(() => {
    const set = (k: 'theme' | 'palette' | 'accent', v: string | null) => {
      if (v === null) delete document.documentElement.dataset[k];
      else document.documentElement.dataset[k] = v;
    };
    set('theme', appearance === 'system' ? null : appearance);
    set('palette', palette === 'default' ? null : palette);
    set('accent', palette === 'contrast' ? accent : null);
  });

  const appearanceOptions = [
    { value: 'system', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];
  const accentOptions = [
    { value: 'blue', label: 'Blue' },
    { value: 'orange', label: 'Orange' },
    { value: 'green', label: 'Green' },
    { value: 'purple', label: 'Purple' }
  ];

  /* ---- Foundations data ---- */

  /* Color roles, in the order they build up a screen: grounds, then ink, then
     the meaningful colors. Each reads its live value from the current theme. */
  const roles = [
    { name: 'bg', use: 'The page behind everything' },
    { name: 'surface', use: 'A card lifted off the page' },
    { name: 'surface-2', use: 'A sunken well or inset track' },
    { name: 'text', use: 'Primary ink' },
    { name: 'text-2', use: 'Secondary ink' },
    { name: 'text-3', use: 'Quiet ink, hints and counts' },
    { name: 'accent', use: 'The one action color' },
    { name: 'accent-ink', use: 'Lettering on a filled accent' },
    { name: 'danger', use: 'Destructive and errors' },
    { name: 'amber', use: 'Warnings and caution' },
    { name: 'line', use: 'Hairline borders' }
  ];

  /* The nine palettes, with a representative light-mode swatch so the whole set
     shows at once. Tapping one previews it live above. Values mirror app.css. */
  const palettes = [
    { id: 'default', label: 'Thicket', note: 'Cream paper, moss green. The default.', bg: '#f6f1e8', accent: '#2f5d3a' },
    { id: 'kingfisher', label: 'Kingfisher', note: 'Cool white, river blue. Vivid.', bg: '#eef3f7', accent: '#0b5fa5' },
    { id: 'slate', label: 'Slate', note: 'Blue-gray stone, steel. Cool and calm.', bg: '#eceff2', accent: '#3f5f7a' },
    { id: 'ember', label: 'Ember', note: 'Ivory, burnt orange. Warm and awake.', bg: '#fbf4ec', accent: '#b93c0a' },
    { id: 'parchment', label: 'Parchment', note: 'Sepia on old paper. Soft on the eyes.', bg: '#eadfcb', accent: '#7a5535' },
    { id: 'graphite', label: 'Graphite', note: 'Plain grays, quiet steel.', bg: '#f0f0ef', accent: '#465a7c' },
    { id: 'fog', label: 'Fog', note: 'Gray on gray, sage. The gentlest.', bg: '#e6e7e6', accent: '#556a67' },
    { id: 'contrast', label: 'High contrast', note: 'Black and white, hard edges, one strong accent.', bg: '#ffffff', accent: '#0050a0' },
    { id: 'mono', label: 'Black and white', note: 'Two colors, no shading. For e-ink.', bg: '#ffffff', accent: '#000000' }
  ];

  /* The type ladder: seven named interface sizes, plus the reading size. */
  const typeScale = [
    { name: 'text-2xl', px: 26, use: 'Page headings' },
    { name: 'text-xl', px: 21, use: 'Section headings' },
    { name: 'text-lg', px: 20, use: 'Card titles' },
    { name: 'text-reading', px: 17, use: 'Article body' },
    { name: 'text-base', px: 16, use: 'Body and controls' },
    { name: 'text-sm', px: 14, use: 'Secondary and controls' },
    { name: 'text-xs', px: 12, use: 'Badges and eyebrows' }
  ];

  const faces = [
    { name: 'Serif', varName: '--font-serif', note: 'Literata. Headlines and, if you choose, reading.' },
    { name: 'Sans-serif', varName: '--font-sans', note: "Your device's own face. The interface default." },
    { name: 'OpenDyslexic', varName: '--font-dyslexic', note: 'Weighted letterforms, harder to flip or swap.' }
  ];

  const spacing = [
    { name: 'space-1', px: 4 },
    { name: 'space-2', px: 8 },
    { name: 'space-3', px: 12 },
    { name: 'space-4', px: 16 },
    { name: 'space-5', px: 24 },
    { name: 'space-6', px: 32 }
  ];

  const corners = [
    { name: 'radius-xs', px: 4, use: 'Inline code, highlight marks' },
    { name: 'radius-sm', px: 10, use: 'Controls, rows, inputs' },
    { name: 'radius-md', px: 14, use: 'Menus, compact cards' },
    { name: 'radius', px: 16, use: 'Cards, the reader, panels' },
    { name: 'radius-lg', px: 20, use: 'Sheets and dialogs' },
    { name: 'radius-pill', px: 999, use: 'Buttons, chips, tabs' }
  ];

  const shadows = [
    { name: 'shadow', use: 'A card resting on the page' },
    { name: 'shadow-menu', use: 'A menu or popover' },
    { name: 'shadow-sheet', use: 'A bottom sheet' },
    { name: 'shadow-dialog', use: 'A centered dialog' }
  ];

  /* ---- Component demo state ---- */
  let tab = $state('all');
  let density = $state('cozy');
  let name = $state('');
  let handleValue = $state('');
  let note = $state('A short note, to show the counter warming up as it fills.');
  let sortBy = $state('new');

  const contentsLinks = [
    { id: 'principles', label: 'Principles' },
    { id: 'color', label: 'Color' },
    { id: 'type', label: 'Type' },
    { id: 'space', label: 'Space & corners' },
    { id: 'elevation', label: 'Elevation' },
    { id: 'buttons', label: 'Buttons' },
    { id: 'forms', label: 'Forms' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'navigation', label: 'Navigation' },
    { id: 'identity', label: 'Identity' }
  ];
</script>

<svelte:head><title>thicket · design system</title></svelte:head>

<article class="ds">
  <header class="masthead">
    <p class="eyebrow">Design system</p>
    <h1>The pieces thicket is built from</h1>
    <p class="lede">
      One reading app, drawn from a small kit: a handful of colors, one type
      ladder, a few controls. Everything hangs off named tokens, so the whole
      app re-skins from one place. What you see below is the real thing —
      change the theme and every part reacts.
    </p>

    <div class="controls" role="group" aria-label="Preview theme">
      <div class="ctl">
        <span class="ctl-label">Mode</span>
        <ChoiceGroup options={appearanceOptions} value={appearance} onchange={(v) => (appearance = v as Appearance)} label="Light or dark" size="sm" />
      </div>
      {#if palette === 'contrast'}
        <div class="ctl">
          <span class="ctl-label">Accent</span>
          <ChoiceGroup options={accentOptions} value={accent} onchange={(v) => (accent = v)} label="High-contrast accent" size="sm" />
        </div>
      {/if}
    </div>

    <nav class="contents" aria-label="On this page">
      {#each contentsLinks as l}
        <a href={`#${l.id}`}>{l.label}</a>
      {/each}
    </nav>
  </header>

  <!-- ============================ PRINCIPLES ============================ -->
  <section id="principles" aria-labelledby="principles-h">
    <h2 id="principles-h">Principles</h2>
    <div class="principles">
      <div class="tile">
        <h3>Everything hangs off tokens</h3>
        <p>No component names a raw color, size, or corner. They reach for a token, and the token decides. Reskinning is a token change, not a component change.</p>
      </div>
      <div class="tile">
        <h3>Three theme states, not two</h3>
        <p>Light and dark, plus "follow the device" — the state most people never leave. On top of that sit nine full color themes, from soft parchment to hard black-and-white for e-ink.</p>
      </div>
      <div class="tile">
        <h3>One of each</h3>
        <p>One button. One card. One text field. If a screen needs something the kit doesn't have, the kit is what changes — so nothing drifts into a second, slightly-different version.</p>
      </div>
      <div class="tile">
        <h3>Readable by default</h3>
        <p>Every color pair clears the contrast bar in both light and dark. Focus rings, keyboard paths, and screen-reader labels are built into the parts, not bolted on later.</p>
      </div>
    </div>
  </section>

  <!-- ============================== COLOR ============================== -->
  <section id="color" aria-labelledby="color-h">
    <h2 id="color-h">Color</h2>
    <p class="section-lede">Each theme names the same set of roles. Components only ever ask for a role — "accent", "danger", "the quiet ink" — never a specific color. These swatches show the roles as the theme above paints them right now.</p>

    <div class="swatches">
      {#each roles as r}
        <div class="swatch">
          <span class="chip" style={`background: var(--${r.name}); border: 1px solid var(--swatch-border);`}></span>
          <span class="swatch-name">--{r.name}</span>
          <span class="swatch-use">{r.use}</span>
        </div>
      {/each}
    </div>

    <h3 class="sub">The nine themes</h3>
    <p class="section-lede">Tap one to try it on. The whole page follows.</p>
    <div class="palettes">
      {#each palettes as p}
        <button type="button" class="palette" class:on={palette === p.id} aria-pressed={palette === p.id} onclick={() => (palette = p.id)}>
          <span class="palette-preview" style={`background: ${p.bg};`}>
            <span class="palette-dot" style={`background: ${p.accent};`}></span>
          </span>
          <span class="palette-label">{p.label}</span>
          <span class="palette-note">{p.note}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- ============================== TYPE =============================== -->
  <section id="type" aria-labelledby="type-h">
    <h2 id="type-h">Type</h2>
    <p class="section-lede">One ladder of seven interface sizes; every piece of text in the app is one rung. A reader can scale any of three roles — headlines, reading text, the interface — and the whole ladder moves with them.</p>

    <div class="type-scale">
      {#each typeScale as t}
        <div class="type-row">
          <span class="type-sample" style={`font-size: ${t.px}px;`}>Thicket reads quietly</span>
          <span class="type-meta"><code>--{t.name}</code> · {t.px}px · {t.use}</span>
        </div>
      {/each}
    </div>

    <h3 class="sub">The three faces</h3>
    <div class="faces">
      {#each faces as f}
        <div class="face">
          <span class="face-sample" style={`font-family: var(${f.varName});`}>The river runs on, newest first.</span>
          <span class="face-meta"><strong>{f.name}</strong> — {f.note}</span>
        </div>
      {/each}
    </div>
  </section>

  <!-- =========================== SPACE + CORNERS ======================= -->
  <section id="space" aria-labelledby="space-h">
    <h2 id="space-h">Space &amp; corners</h2>
    <p class="section-lede">Two small ladders keep the app on one grid. Padding and gaps pick a spacing step; every rounded corner picks a radius. No one-off pixels.</p>

    <h3 class="sub">Spacing — a 4px ladder</h3>
    <div class="bars">
      {#each spacing as s}
        <div class="bar-row">
          <span class="bar" style={`width: var(--${s.name});`}></span>
          <span class="bar-meta"><code>--{s.name}</code> · {s.px}px</span>
        </div>
      {/each}
    </div>

    <h3 class="sub">Corners</h3>
    <div class="corners">
      {#each corners as c}
        <div class="corner">
          <span class="corner-box" style={`border-radius: var(--${c.name});`}></span>
          <span class="corner-name"><code>--{c.name}</code></span>
          <span class="corner-use">{c.use}</span>
        </div>
      {/each}
    </div>
  </section>

  <!-- ============================ ELEVATION ============================ -->
  <section id="elevation" aria-labelledby="elevation-h">
    <h2 id="elevation-h">Elevation</h2>
    <p class="section-lede">One shadow per kind of thing that floats above the page, so a sheet, a menu, and a dialog are never each drawn a little differently. The two hard-edged themes drop shadows entirely and outline their cards instead.</p>
    <div class="elevations">
      {#each shadows as s}
        <div class="elevation">
          <span class="elevation-box" style={`box-shadow: var(--${s.name});`}></span>
          <span class="elevation-name"><code>--{s.name}</code></span>
          <span class="elevation-use">{s.use}</span>
        </div>
      {/each}
    </div>
  </section>

  <!-- ============================= BUTTONS ============================= -->
  <section id="buttons" aria-labelledby="buttons-h">
    <h2 id="buttons-h">Buttons</h2>
    <p class="section-lede">One button, three looks. Primary for the main move, ghost for everything else, danger for the destructive one. Three sizes; a solid fill for when a ghost needs more presence.</p>

    <div class="row">
      <Button variant="primary">Primary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="primary" solid>Solid</Button>
    </div>
    <div class="row">
      <Button variant="primary" size="sm">Small</Button>
      <Button variant="primary" size="md">Medium</Button>
      <Button variant="primary" size="lg">Large</Button>
    </div>
    <div class="row">
      <Button variant="primary" disabled>Disabled</Button>
      <Button variant="primary" loading>Loading</Button>
    </div>

    <h3 class="sub">Icon buttons</h3>
    <p class="section-lede">A round tap target with one glyph and no words. Plain, or bordered for the one that sits beside a page title.</p>
    <div class="row">
      <IconButton icon="gear" label="Settings" />
      <IconButton icon="pencil" label="Edit" />
      <IconButton icon="bookmark" label="Bookmark" />
      <IconButton icon="dots" label="More" />
      <IconButton icon="close" label="Close" />
      <IconButton icon="pencil" label="Edit" variant="bordered" />
      <IconButton icon="bookmark" label="Bookmarked" pressed={true} />
    </div>
  </section>

  <!-- ============================== FORMS ============================= -->
  <section id="forms" aria-labelledby="forms-h">
    <h2 id="forms-h">Forms</h2>
    <p class="section-lede">A field is the label, the control, and the note or error beneath it. Every text box is the same rounded rectangle, with a focus ring that only thickens for someone arriving by keyboard.</p>

    <div class="stack">
      <Field label="Display name" hint="Shown on your notes and profile.">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} bind:value={name} placeholder="Ada Lovelace" />
        {/snippet}
      </Field>

      <Field label="Handle" error="That handle is already taken.">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} bind:value={handleValue} placeholder="ada">
            {#snippet leading()}<span class="prefix">@</span>{/snippet}
          </Input>
        {/snippet}
      </Field>

      <Field label="Search" hideLabel>
        {#snippet children({ id, describedBy })}
          <Input {id} aria-describedby={describedBy} variant="search" placeholder="Search feeds…" value="" />
        {/snippet}
      </Field>

      <Field label="Your note" hint="Nearly-full and over-full change color.">
        {#snippet children({ id, describedBy, invalid })}
          <Textarea {id} aria-describedby={describedBy} {invalid} bind:value={note} counter maxlength={120} rows={3} />
        {/snippet}
      </Field>

      <Select
        label="Sort by"
        bind:value={sortBy}
        options={[
          { value: 'new', label: 'Newest first' },
          { value: 'old', label: 'Oldest first' },
          { value: 'source', label: 'By source' }
        ]}
      />
    </div>
  </section>

  <!-- ============================ FEEDBACK ============================ -->
  <section id="feedback" aria-labelledby="feedback-h">
    <h2 id="feedback-h">Feedback</h2>

    <h3 class="sub">Badges</h3>
    <p class="section-lede">A short status word or a count that rides alongside something else. Never something you press.</p>
    <div class="row baseline">
      <Badge>Private</Badge>
      <Badge>12</Badge>
      <Badge tone="accent">3 new</Badge>
      <span class="dot-demo">New<Badge variant="dot" title="Something new" /></span>
    </div>

    <h3 class="sub">Banners</h3>
    <p class="section-lede">An inline notice inside a page. The tone sets the color and icon.</p>
    <div class="stack">
      <Banner tone="info" title="Heads up">Context, nothing wrong. The quiet one.</Banner>
      <Banner tone="success" title="Saved">Your changes are in.</Banner>
      <Banner tone="warning" title="Check this">Something wants attention soon.</Banner>
      <Banner tone="error" title="That didn't work" dismissible ondismiss={() => {}}>Something failed, and here is why.</Banner>
    </div>

    <h3 class="sub">Toast</h3>
    <p class="section-lede">A brief message at the edge of the screen, often carrying an undo — the app's main safety net.</p>
    <div class="row">
      <Button variant="ghost" onclick={() => showToast('Feed removed', { label: 'Undo', run: () => showToast('Feed restored') })}>Show a toast</Button>
    </div>
  </section>

  <!-- =========================== NAVIGATION =========================== -->
  <section id="navigation" aria-labelledby="navigation-h">
    <h2 id="navigation-h">Navigation</h2>

    <h3 class="sub">Tabs</h3>
    <p class="section-lede">Switch what you're looking at. Pressing a tab swaps the content below it.</p>
    <Tabs
      tabs={[
        { value: 'all', label: 'Everything' },
        { value: 'unread', label: 'Feeds', count: 24 },
        { value: 'notes', label: 'Notes', count: 3 },
        { value: 'saved', label: 'Bookmarks' }
      ]}
      value={tab}
      onchange={(v) => (tab = v)}
      label="Example view"
    />

    <h3 class="sub">Choice group</h3>
    <p class="section-lede">Pick one, and it takes effect at once — a setting, not a tab. Nothing else on the page moves.</p>
    <ChoiceGroup
      options={[
        { value: 'cozy', label: 'Cozy' },
        { value: 'compact', label: 'Compact' },
        { value: 'roomy', label: 'Roomy' }
      ]}
      value={density}
      onchange={(v) => (density = v)}
      label="Density"
    />
  </section>

  <!-- ============================= IDENTITY ============================ -->
  <section id="identity" aria-labelledby="identity-h">
    <h2 id="identity-h">Identity</h2>
    <p class="section-lede">A person's face falls back to a monogram; a source with no icon gets one too. Both are drawn here, so nothing depends on a service that could go away.</p>
    <div class="row baseline">
      <Avatar handle="ada" name="Ada Lovelace" size={48} />
      <Avatar handle="grace" name="Grace Hopper" size={36} />
      <Avatar handle="alan" name="Alan Turing" size={28} />
      <Monogram name="The Verge" size={48} />
      <Monogram name="Quanta" size={36} />
      <Monogram name="Longreads" size={28} />
    </div>
  </section>

  <footer class="ds-foot">
    <p>Every part on this page is the same code that ships in the app. Change one in <code>lib/components</code> or a token in <code>app.css</code>, and it changes here too.</p>
    <p><a href="/">← Back to thicket</a></p>
  </footer>
</article>

<style>
  .ds { color: var(--text); }

  /* ---- Masthead ---- */
  .masthead { margin-bottom: var(--space-6); }
  .eyebrow {
    margin: 0 0 var(--space-2); text-transform: uppercase; letter-spacing: 0.08em;
    font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 700; color: var(--text-3);
  }
  h1 {
    font-family: var(--font-headings); font-weight: 700; letter-spacing: -0.01em;
    font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-3); line-height: 1.15;
  }
  .lede {
    margin: 0; color: var(--text-2); max-width: 60ch; line-height: 1.5;
    font-size: calc(var(--text-base) * var(--size-app));
  }

  .controls { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-top: var(--space-5); }
  .ctl { display: flex; flex-direction: column; gap: var(--space-2); }
  .ctl-label {
    font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 700; color: var(--text-3);
    text-transform: uppercase; letter-spacing: 0.06em;
  }

  .contents {
    display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3);
    margin-top: var(--space-5); padding-top: var(--space-4); border-top: 1px solid var(--line);
  }
  .contents a {
    color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600;
    padding: 2px 0;
  }
  .contents a:hover { color: var(--accent); text-decoration: underline; }

  /* ---- Sections ---- */
  section { margin: var(--space-6) 0; padding-top: var(--space-5); border-top: 1px solid var(--line); }
  h2 {
    font-family: var(--font-headings); font-weight: 700;
    font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-3);
  }
  h3.sub {
    font-size: calc(var(--text-base) * var(--size-app)); font-weight: 700;
    margin: var(--space-5) 0 var(--space-3);
  }
  .section-lede {
    margin: 0 0 var(--space-4); color: var(--text-2); max-width: 60ch; line-height: 1.5;
    font-size: calc(var(--text-sm) * var(--size-app));
  }

  /* ---- Principles ---- */
  .principles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3); }
  .tile {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--space-4); box-shadow: var(--shadow);
  }
  .tile h3 { margin: 0 0 var(--space-2); font-size: calc(var(--text-base) * var(--size-app)); font-weight: 700; }
  .tile p { margin: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.5; }

  /* ---- Color ---- */
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--space-3); }
  .swatch { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: var(--space-2); align-items: center; }
  .chip { grid-row: 1 / 3; width: 34px; height: 34px; border-radius: var(--radius-sm); display: block; }
  .swatch-name { font-family: ui-monospace, monospace; font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 600; }
  .swatch-use { color: var(--text-3); font-size: calc(var(--text-xs) * var(--size-app)); line-height: 1.3; }

  .palettes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-3); }
  .palette {
    text-align: left; display: flex; flex-direction: column; gap: var(--space-1);
    padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--surface);
  }
  .palette.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .palette-preview {
    height: 40px; border-radius: var(--radius-sm); border: 1px solid var(--swatch-border);
    display: flex; align-items: flex-end; padding: var(--space-2);
  }
  .palette-dot { width: 16px; height: 16px; border-radius: var(--radius-pill); }
  .palette-label { font-weight: 700; font-size: calc(var(--text-sm) * var(--size-app)); margin-top: var(--space-1); }
  .palette-note { color: var(--text-3); font-size: calc(var(--text-xs) * var(--size-app)); line-height: 1.3; }

  /* ---- Type ---- */
  .type-scale { display: flex; flex-direction: column; gap: var(--space-3); }
  .type-row { display: flex; flex-direction: column; gap: 2px; }
  .type-sample { font-family: var(--font-headings); line-height: 1.1; color: var(--text); }
  .type-meta { font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-3); }
  .type-meta code, .bar-meta code, .corner-name code, .elevation-name code { font-family: ui-monospace, monospace; }

  .faces { display: flex; flex-direction: column; gap: var(--space-4); }
  .face { display: flex; flex-direction: column; gap: 2px; }
  .face-sample { font-size: calc(var(--text-lg) * var(--size-app)); color: var(--text); }
  .face-meta { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }

  /* ---- Space + corners ---- */
  .bars { display: flex; flex-direction: column; gap: var(--space-2); }
  .bar-row { display: flex; align-items: center; gap: var(--space-3); }
  .bar { height: 16px; background: var(--accent); border-radius: var(--radius-xs); flex: none; }
  .bar-meta { font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-3); }

  .corners { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--space-4); margin-top: var(--space-3); }
  .corner { display: flex; flex-direction: column; gap: var(--space-1); }
  .corner-box { height: 60px; background: var(--surface-2); border: 1px solid var(--line); }
  .corner-name { font-size: calc(var(--text-xs) * var(--size-app)); }
  .corner-use { font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-3); line-height: 1.3; }

  /* ---- Elevation ---- */
  .elevations { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-5); padding: var(--space-2) 0; }
  .elevation { display: flex; flex-direction: column; gap: var(--space-2); }
  .elevation-box { height: 64px; background: var(--surface); border-radius: var(--radius); }
  .elevation-name { font-size: calc(var(--text-xs) * var(--size-app)); }
  .elevation-use { font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-3); }

  /* ---- Component demos ---- */
  .row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-3); }
  .row.baseline { align-items: center; }
  .stack { display: flex; flex-direction: column; gap: var(--space-4); max-width: 460px; }
  .prefix { color: var(--text-3); }
  .dot-demo { display: inline-flex; align-items: center; gap: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }

  /* ---- Footer ---- */
  .ds-foot { margin-top: var(--space-6); padding-top: var(--space-5); border-top: 1px solid var(--line); color: var(--text-3); }
  .ds-foot p { margin: 0 0 var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); max-width: 60ch; line-height: 1.5; }
  .ds-foot code { font-family: ui-monospace, monospace; }
  .ds-foot a { color: var(--accent); font-weight: 600; }
  .ds-foot a:hover { text-decoration: underline; }
</style>
