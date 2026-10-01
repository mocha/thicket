<script lang="ts">
  /**
   * The redesigned front door, shown at the unlinked /preview/landing while it's
   * reviewed; the live home page (Home.svelte) is unchanged until it replaces it.
   * The front door for people who are not signed in. The first screen is the
   * headline and one line, in a top section with a picture of reading in
   * thicket; the header carries the way in (Sign up, or for someone signed in,
   * one click into Everything). The green carries on below it, holding a
   * panel of three things you do and then the sign-up form beside the four
   * differences. Then real collections to open.
   * Words chosen for people who have never heard of RSS: "sites" and "posts",
   * never "feeds".
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import SignUpForm from './SignUpForm.svelte';
  import PhoneFeed from './PhoneFeed.svelte';
  import StarterPacks from './StarterPacks.svelte';
  import Card from './Card.svelte';
  import HeroForest from './HeroForest.svelte';
  import HeroTable from './HeroTable.svelte';

  onMount(() => api.event('home_view'));

  // TEMPORARY: headline options for review (?v=a|b|c). Remove before the PR.
  import { page } from '$app/state';
  const OPTIONS: Record<string, [string, string]> = {
    a: ['Read the web on your own terms', 'No algorithm deciding what you see. Just everything from the sites you choose, newest first.'],
    b: ['Read the web, not the algorithm', 'Social feeds show you more of what you already believe. thicket shows you everything from the sites you choose, in the order it was published.'],
    c: ['Step outside the bubble', 'Algorithms feed you more of the same, and the angriest version of it. thicket shows you everything from the sites you choose, newest first.']
  };
  const opt = $derived(OPTIONS[page.url.searchParams.get('v') ?? ''] ?? null);
  // TEMPORARY: two looks for the top section (?hero=table for the scattered cards). Remove before the PR.
  const table = $derived(page.url.searchParams.get('hero') === 'table');

  const apart = [
    { title: 'Newest first, always', body: 'The latest posts come first, and nothing is reordered.' },
    { title: 'No recommendations, no infinite scroll', body: 'You reach the end of what’s new, and then you’re done.' },
    { title: 'No ads, no tracking, nothing to sell', body: 'What you read is your business.' },
    { title: 'Your collections are yours', body: 'Download them anytime and take them to any feed reader.' }
  ];

  const features = [
    { title: 'Follow', body: 'Paste any site’s address. Blogs, newspapers, newsletters, podcasts, and YouTube all work.', icon: 'M12 5v14M5 12h14' },
    { title: 'Collect', body: 'Sort sites into collections like <em>News</em> or <em>Slow Sunday</em>, and read one at a time when everything is too much.', icon: 'M4 6h16M4 12h16M4 18h10' },
    { title: 'Bookmark', body: 'Save a post to find it again later. Your bookmarks are yours, filterable by where they came from.', icon: 'M6 4h12v17l-6-4-6 4z' },
    { title: 'Share', body: 'Every collection has a link anyone can read. Send it to a friend to enjoy with no account needed.', icon: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13' },
    { title: 'Remix', body: 'Like someone’s collection? Copy it into your space with one tap, then add and remove sites to fit your taste.', icon: 'M7 7h10v10H7zM3 3h10v4M21 21H11v-4' }
  ];
</script>

{#snippet pitch()}
  <h1>{opt?.[0] ?? 'Read the web on your own terms'}</h1>
  <p class="sub">{#if opt}{opt[1]}{:else}<mark>Social feeds use algorithms to decide what you see, but <em>thicket</em> keeps it simple.</mark> Follow the websites you like, and read everything they publish in one place, newest first.{/if}</p>
{/snippet}

<!-- How it works, then why thicket is different with the phone beside it on the right. Signed in, the
     phone stays at the top and the differences stand alone. All of it sits on
     the same green as the top. -->
<!-- Signed out, the form sits beside the headline (the header's Sign up jumps
     here) and the phone moves down beside why thicket is different. -->
{#snippet signUp()}
  <section id="sign-up" class="join" aria-label="Sign up">
    <div class="auth"><SignUpForm /></div>
  </section>
{/snippet}

{#snippet below()}
<section class="features">
  <h2>How it works</h2>
  <ul>
    {#each features as f (f.title)}
      <Card as="li">
        <div class="head">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={f.icon} /></svg>
          <h3>{f.title}</h3>
        </div>
        <!-- Written here, not user content, so a little markup (italic collection names) is safe. -->
        <p>{@html f.body}</p>
      </Card>
    {/each}
  </ul>
</section>

<div class="pair" class:solo={!!session.user}>
  <section class="apart">
    <h2>thicket replaces your social feed</h2>
    <ul>
      {#each apart as a (a.title)}
        <li>
          <!-- A small leaf, drawn like the fronds' leaflets, as each point's marker. -->
          <svg class="leaf" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 20C4 11 10 4 20 4 20 14 13 20 4 20Z" /><path class="vein" d="M5 19 17 7" /></svg>
          <div><h3>{a.title}</h3><p>{a.body}</p></div>
        </li>
      {/each}
    </ul>
  </section>
  {#if !session.user}
    <div class="phone-spot"><PhoneFeed /></div>
  {/if}
</div>
{/snippet}

<div class="top">
  {#if table}
    <HeroTable {pitch} />
    {#if !session.user}{@render signUp()}{/if}
    {@render below()}
  {:else}
    <HeroForest {pitch} aside={session.user ? undefined : signUp} {below} leaves={page.url.searchParams.get('leaves') ?? 'fronds'} />
  {/if}
</div>

<div class="peek"><StarterPacks heading="Peek inside" lede="Open a collection and start reading now. No account needed." /></div>

<footer>
  <p>thicket is free, open-source software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">AGPL</a>.<br /><a href="https://github.com/mocha/thicket" rel="noopener">Read the source</a> or run your own thicket site.</p>
</footer>

<style>
  /* The top section's color starts right under the line below the logo. */
  .top { margin-top: calc(-1 * var(--space-5)); }
  /* The color change already divides the top section from the next, so no rule between them. */
  /* The green band sits between sections with the same room above and below. */
  /* One large rounded panel floating on the green: a faint, frosted wash of
     cream rather than a solid block, so the forest shows through. The white
     cards inside carry the dark text; the heading reads in cream like the
     others on the green. */
  .features {
    position: relative; z-index: 1; margin-bottom: calc(var(--space-6) * 3.5);
    padding: calc(var(--space-6) + var(--space-4)) calc(var(--space-6) + var(--space-2));
    background: color-mix(in srgb, #f6f1e8 10%, transparent);
    border: 1px solid color-mix(in srgb, #f6f1e8 16%, transparent);
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    border-radius: calc(var(--radius-lg) * 1.6);
  }
  .features :global(.card) { color: var(--text); }
  /* The ladder's largest heading size, so the panel reads as its own section. */
  .features h2 { font-size: calc(var(--text-3xl) * var(--size-headings)); }
  .peek { margin-top: calc(var(--space-6) * 2); }
  .pair { display: grid; gap: calc(var(--space-6) * 2); }
  .join { display: flex; flex-direction: column; scroll-margin-top: var(--space-5); }
  .phone-spot { min-width: 0; align-self: center; }
  /* Beside the form, the heading lines up with the points under it. */
  .pair:not(.solo) .apart h2 { text-align: left; }
  .auth { width: 100%; max-width: 24rem; }
  h1 { font-family: var(--font-headings); font-size: clamp(34px, 5vw, 52px); line-height: 1.15; margin: 0 0 var(--space-5); letter-spacing: -0.015em; }
  .sub { font-size: clamp(18px, 2.2vw, 22px); color: var(--text-2); margin: 0; line-height: 1.6; max-width: 32ch; }
  h2 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-5); text-align: center; }
  /* The collections section brings its own heading and intro line; center both to match. */
  .peek :global(h2), .peek :global(.lede) { text-align: center; margin-inline: auto; }
  .apart ul { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(var(--space-5) + var(--space-1)); }
  /* The leaf sits beside the title, the text in a column of its own beside it. */
  .apart li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-3); align-items: start; }
  .apart .leaf { margin-top: 2px; fill: #7fb08a; }
  .apart .leaf .vein { fill: none; stroke: color-mix(in srgb, #15291c 55%, transparent); stroke-width: 1.4; stroke-linecap: round; }
  .apart h3 { margin: 0 0 var(--space-1); font-size: calc(var(--text-xl) * var(--size-app)); font-weight: 700; line-height: 1.25; }
  .apart p { margin: 0; color: var(--forest-ink-2, var(--text-2)); font-size: calc(var(--text-reading) * var(--size-app)); line-height: 1.45; }
  .features ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-5); }
  /* The icon and the heading share a line. */
  .features .head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
  .features svg { flex: none; color: var(--accent); }
  .features h3 { margin: 0; color: var(--accent); font-size: calc(var(--text-base) * var(--size-app)); font-weight: 700; }
  .features p { margin: 0; color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); line-height: 1.45; }
  footer { margin: calc(var(--space-6) * 2) 0 0; padding-top: var(--space-5); border-top: 1px solid var(--line); color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  /* One sentence to a line. */
  footer p { margin: 0; text-wrap: pretty; }
  footer a { color: var(--accent); font-weight: 600; }
  @media (min-width: 820px) {
    /* Side by side: the form, then the differences in one column. Alone, the differences take two. */
    .pair:not(.solo) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(var(--space-6) + var(--space-5)); align-items: center; }
    .solo .apart ul { grid-template-columns: repeat(2, 1fr); gap: var(--space-5) calc(var(--space-6) + var(--space-1)); }
    /* Five cards: three across, then the last two centered under them. */
    .features ul { grid-template-columns: repeat(6, 1fr); }
    .features ul > :global(li) { grid-column: span 2; }
    .features ul > :global(li:nth-child(4)) { grid-column: 2 / span 2; }
  }
</style>
