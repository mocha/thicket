<script lang="ts">
  /**
   * The intro's New posts picture: a few miniature article cards, then two new
   * posts arrive at the top and push the rest down, in order, nothing jumping
   * the queue. It plays once and rests. Every card's resting style is its final
   * state and the animations only run from hidden to there, so when motion is
   * off (reduced motion, or Black and white) the finished picture shows at once.
   * The sites are made up: real publishers here would read as partners.
   */
  const ARRIVING = [
    { site: 'Backyard Birding', time: 'just now', title: 'Warblers are passing through early' },
    { site: 'Slow Kitchen', time: '1 min', was: 'just now', title: 'A soup that tastes like all day' }
  ];
  const WAITING = [
    { site: 'Night Sky Notes', time: '18 min', title: 'Finding Andromeda by eye' },
    { site: 'Small Trains', time: '1 hr', title: 'Rebuilding a 1950s layout' },
    { site: 'The Plot', time: '2 hr', title: 'What to plant now for spring' }
  ];
</script>

{#snippet card(c: { site: string; time: string; was?: string; title: string })}
  <div class="card">
    <p class="meta">
      <span class="fav">{c.site[0]}</span><span class="site">{c.site}</span><span aria-hidden="true">·</span>
      {#if c.was}<span class="time swap"><span class="was">{c.was}</span><span class="now">{c.time}</span></span>{:else}<span class="time">{c.time}</span>{/if}
    </p>
    <p class="title">{c.title}</p>
  </div>
{/snippet}

<div class="list">
  {#each ARRIVING as c, i (c.site)}
    <!-- Slow Kitchen (the second) arrives first, then Backyard Birding lands above it. -->
    <div class="arrive" style="--at: {i === 0 ? 1700 : 700}ms">{@render card(c)}</div>
  {/each}
  {#each WAITING as c (c.site)}<div class="row">{@render card(c)}</div>{/each}
</div>

<style>
  .list { display: flex; flex-direction: column; width: min(340px, 86%); margin: 0 auto; padding-top: var(--space-5); }
  .row, .arrive { padding-bottom: var(--space-2); }
  .card {
    background: var(--surface); border-radius: var(--radius-sm); box-shadow: var(--shadow); border: var(--card-border, 0);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .meta { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .fav {
    display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; flex: none;
    background: var(--surface-2); color: var(--text-2); font-size: 10px; font-weight: 700;
  }
  .site { font-weight: 600; color: var(--text); }
  .title {
    margin: var(--space-1) 0 0; font-family: var(--font-headings); font-weight: 600; font-size: 14px; line-height: 1.3; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* An arriving post opens its own room (which pushes the others down), then
     drops into it; a ring in the accent fades once it has landed. Every card is
     one line of title, so its height is known and the room opens by exactly that. */
  .card { box-sizing: border-box; height: var(--card-h); }
  .list { --card-h: 50px; }
  .arrive { animation: open 520ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--at) backwards; }
  .arrive > .card { animation: land 520ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--at) backwards, ring 1400ms ease-out calc(var(--at) + 300ms) backwards; }
  @keyframes open { from { margin-top: calc(-1 * (var(--card-h) + var(--space-2))); } }
  @keyframes land { from { opacity: 0; transform: translateY(-14px) scale(0.97); } }
  @keyframes ring { from { box-shadow: 0 0 0 2px var(--accent), var(--shadow); } to { box-shadow: 0 0 0 2px transparent, var(--shadow); } }

  /* Slow Kitchen's "just now" turns to "1 min" as the next post lands above it. */
  .swap { display: inline-grid; }
  .swap > span { grid-area: 1 / 1; }
  .was { opacity: 0; animation: was 1700ms linear backwards; }
  .now { animation: now 300ms ease-out 1700ms backwards; }
  @keyframes was { from, 99% { opacity: 1; } to { opacity: 0; } }
  @keyframes now { from { opacity: 0; } }
</style>
