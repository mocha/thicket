<script lang="ts">
  /**
   * The top of a screen someone sees before they have anything to show on
   * it: a centered headline in the headings face, a larger gray line under
   * it, then a hairline as wide as what follows. New posts and Collections use it
   * when you follow nothing (StarterWelcome).
   */
  let { title, sub }: { title: string; sub: string } = $props();
</script>

<header class="welcome">
  <h1>{title}</h1>
  <p class="sub">{sub}</p>
</header>
<hr class="split" />

<style>
  /* The welcome block breathes more than a regular page top: room above the
     headline, and a clear break before what follows. */
  .welcome { text-align: center; margin: var(--space-6) 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-3xl) * var(--size-headings)); margin: 0; min-width: 0; }
  /* Balanced, so a line that wraps never leaves one word alone below. */
  .sub { margin: var(--space-2) auto 0; color: var(--text-2); font-size: calc(var(--text-xl) * var(--size-app)); max-width: 62ch; text-wrap: balance; }
  /* A hairline as wide as the cards below it. */
  .split { width: 100%; margin: 0 auto var(--space-6); border: 0; border-top: 1px solid var(--line); }
</style>
