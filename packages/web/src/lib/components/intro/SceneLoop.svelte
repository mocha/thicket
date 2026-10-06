<script lang="ts">
  /**
   * Plays a tour picture on a loop: the picture acts itself out, rests on its
   * finished state, fades, and starts again. Starting again is a fresh copy, so
   * every animation inside runs from the top. Pictures style their finished
   * state as the resting one and animate only toward it, so when motion is off
   * (reduced motion, or Black and white) the finished picture shows and stays:
   * looping then would only make it blink.
   */
  import type { Snippet } from 'svelte';

  let { round, children }: { /** One full round, in ms, rest included. */ round: number; children: Snippet } = $props();
  const FADE = 400;
  let n = $state(0);
  let fading = $state(false);
  // Asking for less motion partway through stops the loop at once, rather than
  // leaving it to blank the picture every round.
  const calm = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = $state(calm?.matches ?? false);
  $effect(() => {
    if (!calm) return;
    const changed = () => { reduced = calm.matches; };
    calm.addEventListener('change', changed);
    return () => calm.removeEventListener('change', changed);
  });
  $effect(() => {
    if (reduced || document.documentElement.dataset.palette === 'mono') { fading = false; return; }
    let out: ReturnType<typeof setTimeout>;
    const timer = setInterval(() => {
      fading = true;
      out = setTimeout(() => { n++; fading = false; }, FADE);
    }, round);
    return () => { clearInterval(timer); clearTimeout(out); };
  });
</script>

{#key n}<div class="loop" class:fading>{@render children()}</div>{/key}

<style>
  .loop { position: absolute; inset: 0; transition: opacity 400ms ease; }
  .fading { opacity: 0; }
</style>
