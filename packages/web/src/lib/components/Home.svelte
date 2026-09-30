<script lang="ts">
  /**
   * The front door for people who are not signed in. The first screen is the
   * headline, one line, and the sign-up box, which must never need a scroll.
   * Then the four differences in a line each, then real collections to open,
   * then three things you do.
   * Words chosen for people who have never heard of RSS: "sites" and "posts",
   * never "feeds".
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import AuthBox from './AuthBox.svelte';
  import StarterPacks from './StarterPacks.svelte';
  import Card from './Card.svelte';

  onMount(() => api.event('home_view'));

  const apart = [
    { title: 'Newest first, nothing reordered', body: 'No ranking decides what you see.' },
    { title: 'You reach the end', body: 'No recommendations, no infinite scroll.' },
    { title: 'What you read is your business', body: 'No ads, no tracking, nothing to sell.' },
    { title: 'Leave anytime', body: 'Your collections copy to any thicket site.' }
  ];

  const features = [
    { title: 'Follow', body: 'Paste any site’s address. Blogs, newspapers, newsletters, podcasts, and YouTube all work.', icon: 'M12 5v14M5 12h14' },
    { title: 'Collect', body: 'Sort sites into collections like News or Slow Sunday, and bookmark posts to find later.', icon: 'M4 6h16M4 12h16M4 18h10' },
    { title: 'Share', body: 'Every collection has a link anyone can read. Like someone’s? Copy it and make it yours.', icon: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13' }
  ];
</script>

<section class="hero">
  <div class="pitch">
    <h1>Read the web on your own terms</h1>
    <p class="sub">Follow the sites you like and read everything they publish in one place</p>
  </div>
  <div class="auth"><AuthBox /></div>
</section>

<hr />

<section class="apart">
  <h2>Unlike a social feed</h2>
  <ul>
    {#each apart as a (a.title)}
      <li><h3>{a.title}</h3><p>{a.body}</p></li>
    {/each}
  </ul>
</section>

<hr />

<StarterPacks heading="Peek inside" lede="Open one and read it, no account needed." />

<hr />

<section class="features">
  <h2>How it works</h2>
  <ul>
    {#each features as f (f.title)}
      <Card as="li">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={f.icon} /></svg>
        <h3>{f.title}</h3>
        <p>{f.body}</p>
      </Card>
    {/each}
  </ul>
</section>

<footer>
  <p>thicket is free, open-source software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">AGPL</a>. <a href="https://github.com/mocha/thicket" rel="noopener">Read the source</a> or run your own thicket site.</p>
</footer>

<style>
  .hero { display: grid; gap: var(--space-6); padding: var(--space-5) 0 var(--space-2); }
  .auth { align-self: start; }
  h1 { font-family: var(--font-headings); font-size: clamp(34px, 5vw, 52px); line-height: 1.08; margin: 0 0 var(--space-4); letter-spacing: -0.015em; }
  .sub { font-size: clamp(18px, 2.2vw, 22px); color: var(--text-2); margin: 0; line-height: 1.35; max-width: 32ch; }
  hr { border: 0; border-top: 1px solid var(--line); margin: calc(var(--space-6) + var(--space-1)) 0; }
  h2 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-4); }
  .apart ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); }
  .apart h3 { margin: 0 0 var(--space-1); font-size: calc(var(--text-base) * var(--size-app)); font-weight: 700; }
  .apart p { margin: 0; color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); line-height: 1.45; }
  .features ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); }
  .features svg { color: var(--accent); margin-bottom: var(--space-3); }
  .features h3 { margin: 0 0 var(--space-2); font-size: calc(var(--text-base) * var(--size-app)); font-weight: 700; }
  .features p { margin: 0; color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); line-height: 1.45; }
  footer { margin: calc(var(--space-6) + var(--space-3)) 0 0; padding-top: var(--space-5); border-top: 1px solid var(--line); color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  footer p { margin: 0; max-width: 70ch; }
  footer a { color: var(--accent); font-weight: 600; }
  @media (min-width: 820px) {
    .hero { grid-template-columns: 2fr 1fr; align-items: center; gap: calc(var(--space-6) + var(--space-4)); padding: calc(var(--space-6) + var(--space-1)) 0 var(--space-4); }
    .apart ul { grid-template-columns: repeat(2, 1fr); gap: var(--space-5) calc(var(--space-6) + var(--space-1)); }
    .features ul { grid-template-columns: repeat(3, 1fr); }
  }
</style>
