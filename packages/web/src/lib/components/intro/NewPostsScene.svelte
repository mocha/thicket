<script lang="ts">
  /**
   * The tour's New posts picture: a few miniature article cards, then two new
   * posts arrive at the top and push the rest down, in order, nothing jumping
   * the queue. The sites are made up: real publishers here would read as partners.
   */
  import SceneLoop from './SceneLoop.svelte';
  import MiniCard from './MiniCard.svelte';
  import Swap from './Swap.svelte';

  const WAITING = [
    { site: 'Night Sky Notes', time: '18 min', title: 'Finding Andromeda by eye' },
    { site: 'Small Trains', time: '1 hr', title: 'Rebuilding a 1950s layout' },
    { site: 'The Plot', time: '2 hr', title: 'What to plant now for spring' }
  ];
</script>

{#snippet slowTime()}<Swap from="just now" to="1 min" at={1700} />{/snippet}

<SceneLoop round={6000}>
  <div class="list">
    <!-- Slow Kitchen arrives first, then Backyard Birding lands above it. -->
    <div class="arrive" style="--at: 1700ms"><MiniCard site="Backyard Birding" time="just now" title="Warblers are passing through early" /></div>
    <div class="arrive" style="--at: 700ms"><MiniCard site="Slow Kitchen" time={slowTime} title="Ginger soup in 30 minutes" /></div>
    {#each WAITING as c (c.site)}<div class="row"><MiniCard {...c} /></div>{/each}
  </div>
</SceneLoop>

<style>
  .list { --mini-card-h: 50px; display: flex; flex-direction: column; width: min(340px, 86%); margin: 0 auto; padding-top: var(--space-5); }
  .row, .arrive { padding-bottom: var(--space-2); }
  /* An arriving post opens its own room (which pushes the others down), then
     drops into it; a ring in the accent fades once it has landed. */
  .arrive { animation: open 520ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--at) backwards; }
  .arrive > :global(.card) { animation: land 520ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--at) backwards, ring 1400ms ease-out calc(var(--at) + 300ms) backwards; }
  @keyframes open { from { margin-top: calc(-1 * (var(--mini-card-h) + var(--space-2))); } }
  @keyframes land { from { opacity: 0; transform: translateY(-14px) scale(0.97); } }
  @keyframes ring { from { box-shadow: 0 0 0 2px var(--accent), var(--shadow); } to { box-shadow: 0 0 0 2px transparent, var(--shadow); } }
</style>
