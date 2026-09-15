<script lang="ts">
  /**
   * The front door for people who are not signed in. Makes the case in the
   * first screen (headline, three sentences, sign-up box), then a longer
   * pitch, then five cards, then real public collections from this instance
   * so "collections" is not an abstraction. Words chosen for people who have
   * never heard of RSS: "sites" and "posts", never "feeds" in the hero.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import AuthBox from './AuthBox.svelte';
  import StarterPacks from './StarterPacks.svelte';

  onMount(() => api.event('home_view'));

  const apart = [
    {
      title: 'Nobody is protecting the brands',
      body: 'A ranked feed quietly hides how often a company posts, because repetition scores badly. In date order you see it the moment it starts — and you can unfollow. The ordering here is the timestamp, and nothing else.'
    },
    {
      title: 'Nothing is trying to keep you here',
      body: 'No recommendations to pull you along, no notifications engineered to bring you back, no infinite anything. You reach the end of what the sites you chose published, and you are done for the day.'
    },
    {
      title: 'What you read is your business',
      body: 'We do not track what you open, build a profile of you, or keep a history you did not ask us to save. There is nothing to sell because we do not collect it. Library rules.'
    },
    {
      title: 'If you dislike how it is run, run it',
      body: 'thicket is open source and an instance is one small server. Your collections copy from any instance to any other, so leaving is a copy rather than a loss. That is the part a social network cannot offer you.'
    }
  ];

  const features = [
    { title: 'Follow', body: 'Paste the address of any site you like to read. New posts show up in your stream, newest first, with nothing reordered.', icon: 'M12 5v14M5 12h14' },
    { title: 'Collect', body: 'Group sites into collections by topic or mood: News, Friends, Slow Sunday. Read one collection at a time when everything is too much.', icon: 'M4 6h16M4 12h16M4 18h10' },
    { title: 'Bookmark', body: 'Save a post to find it again later. Your bookmarks are yours, filterable by where they came from.', icon: 'M6 4h12v17l-6-4-6 4z' },
    { title: 'Share', body: 'Every collection and your bookmarks have a link. Send it to a friend; they can read it without an account.', icon: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13' },
    { title: 'Remix', body: 'Like someone’s collection? Copy it into your space with one tap, then add and remove sites to fit your taste.', icon: 'M7 7h10v10H7zM3 3h10v4M21 21H11v-4' },
  ];
</script>

<section class="hero">
  <div class="pitch">
    <h1>Read the web on your own terms.</h1>
    <p class="sub">Follow the sites you like. Every new post lands in one calm stream, in the order it was written.</p>
    <p class="body">No ranking deciding what you see, no ads dressed up as posts, nothing about you for sale. Make an account in ten seconds and follow your first site.</p>
  </div>
  <div class="auth"><AuthBox /></div>
</section>

<hr />

<section class="longer">
  <p>The internet is full of interesting things to read. thicket keeps it simple: you follow the websites you like, and it shows you everything they publish in one place, newest first.</p>
</section>

<hr />

<section class="apart">
  <h2>How this is different from a social feed</h2>
  <ul>
    {#each apart as a (a.title)}
      <li><h3>{a.title}</h3><p>{a.body}</p></li>
    {/each}
  </ul>
</section>

<hr />

<section class="features">
  <h2>How it works</h2>
  <ul>
    {#each features as f (f.title)}
      <li>
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={f.icon} /></svg>
        <h3>{f.title}</h3>
        <p>{f.body}</p>
      </li>
    {/each}
  </ul>
  <p class="fine">Works with any site that publishes a feed, which is most of them: blogs, newspapers, newsletters, podcasts, YouTube channels. You never have to know what a feed is.</p>
</section>

<hr />

<StarterPacks
  heading="Peek inside"
  lede="Open one and read it without an account. Make collections of your own later and someone can copy yours the same way." />

<footer>
  <p>thicket is free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">AGPL</a> — the <a href="https://github.com/mocha/thicket" rel="noopener">source is here</a>. Run your own, or join a friend’s: collections can be copied from any instance to any other, so you are never stuck.</p>
</footer>

<style>
  .hero { display: grid; gap: 28px; padding: 20px 0 8px; }
  h1 { font-family: var(--font-headings); font-size: clamp(34px, 5vw, 52px); line-height: 1.08; margin: 0 0 16px; letter-spacing: -0.015em; }
  .sub { font-size: clamp(18px, 2.2vw, 22px); color: var(--text); margin: 0 0 14px; line-height: 1.35; }
  .body { color: var(--text-2); margin: 0; font-size: calc(16px * var(--size-app)); max-width: 46ch; }
  .auth { align-self: start; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 36px 0; }
  .longer p { font-family: var(--font-headings); font-size: clamp(19px, 2.4vw, 24px); line-height: 1.45; margin: 0; max-width: 64ch; }
  h2 { font-family: var(--font-headings); font-size: calc(26px * var(--size-headings)); margin: 0 0 16px; }
  .features ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .features li { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; }
  .features svg { color: var(--accent); margin-bottom: 10px; }
  .features h3 { margin: 0 0 6px; font-size: calc(17px * var(--size-app)); }
  .features p { margin: 0; color: var(--text-2); font-size: calc(15px * var(--size-app)); line-height: 1.45; }
  .fine { margin: 18px 0 0; color: var(--text-3); font-size: calc(14px * var(--size-app)); }
  .apart ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 20px; }
  .apart h3 { font-family: var(--font-headings); margin: 0 0 5px; font-size: calc(18px * var(--size-headings)); }
  .apart p { margin: 0; color: var(--text-2); font-size: calc(15px * var(--size-app)); line-height: 1.5; }
  footer { margin: 44px 0 0; padding-top: 20px; border-top: 1px solid var(--line); color: var(--text-3); font-size: calc(14px * var(--size-app)); }
  footer p { margin: 0; max-width: 70ch; }
  footer a { color: var(--accent); font-weight: 600; }
  @media (min-width: 820px) {
    .hero { grid-template-columns: 2fr 1fr; align-items: center; gap: 48px; padding: 36px 0 16px; }
    .features ul { grid-template-columns: repeat(3, 1fr); }
    .features li:nth-child(4), .features li:nth-child(5) { grid-column: span 1; }
    .apart ul { grid-template-columns: repeat(2, 1fr); gap: 24px 36px; }
  }
  @media (min-width: 820px) and (max-width: 1099px) { .features ul { grid-template-columns: repeat(2, 1fr); } }
</style>
