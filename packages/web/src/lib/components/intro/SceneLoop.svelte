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
  $effect(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.palette === 'mono';
    if (still) return;
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
