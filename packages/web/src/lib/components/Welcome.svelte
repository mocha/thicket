<script lang="ts">
  /**
   * The top of a screen someone sees before they have anything to show on
   * it: a centered headline in the headings face, a larger gray line under
   * it, anything else the screen offers first (a button, a second way in),
   * then a short hairline before what follows. New posts and Collections
   * use it when you follow nothing / have no collections.
   */
  import type { Snippet } from 'svelte';
  let { title, sub, children }: { title: string; sub: string; children?: Snippet } = $props();
</script>

<header class="welcome">
  <h1>{title}</h1>
  <p class="sub">{sub}</p>
  {@render children?.()}
</header>
<hr class="split" />

<style>
  /* The welcome block breathes more than a regular page top: room above the
     headline, a real pause before any button, and a clear break before what follows. */
  .welcome { text-align: center; margin: var(--space-6) 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-3xl) * var(--size-headings)); margin: 0; min-width: 0; }
  /* Balanced, so a line that wraps never leaves one word alone below. */
  .sub { margin: var(--space-2) auto 0; color: var(--text-2); font-size: calc(var(--text-xl) * var(--size-app)); max-width: 62ch; text-wrap: balance; }
  /* A short hairline, one and a half cards wide when the cards below run two
     across: (row - the gap between cards) × 3/4. */
  .split { width: calc((100% - var(--space-4)) * 0.75); margin: 0 auto var(--space-6); border: 0; border-top: 1px solid var(--line); }
</style>
