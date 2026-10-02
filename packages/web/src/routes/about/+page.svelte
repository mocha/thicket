<script lang="ts">
  /**
   * About (issue #159), part of the marketing site and readthicket.com only:
   * why thicket exists and who owns it. Anyone can
   * read it, signed in or not. The footer links here.
   */
  import MarketingPage from '$lib/components/MarketingPage.svelte';

  /** Patrick's says nothing of where he works now, on purpose. */
  const owners = [
    {
      name: 'Patrick Deuley', photo: '/about/patrick-deuley.jpg',
      background: 'Patrick has been building things in tech for more than 20 years, including open-source work at Rackspace and GitLab. Most of his work has focused on Product and Engineering, but he’s worked as a designer, too. He’s a builder through and through. Even his hobbies tend to turn into something new to make.',
      links: [{ label: 'GitHub', icon: 'github', href: 'https://github.com/mocha' }, { label: 'Blog', icon: 'web', href: 'https://deuley.ltd' }]
    },
    {
      name: 'Christie Lenneville', photo: '/about/christie-lenneville.jpg',
      background: 'Christie has spent more than 25 years in tech, most of it making software easier to use. That included leading design at Rackspace and GitLab, working on open source at both, and building GitLab’s all-remote design team before remote was normal. Away from the screen, there’s usually a paintbrush or a jazz band involved.',
      links: [{ label: 'GitHub', icon: 'github', href: 'https://github.com/christielenn' }]
    }
  ];
</script>

<svelte:head><title>About · thicket</title></svelte:head>

<MarketingPage wide>
  <h1>Why we built thicket</h1>
  <p>Not that long ago, we got our information from newspapers, magazines, local TV stations, and a few sites on the web. We heard a wide range of opinions, and it was easy to find reading that was interesting, factual, and enjoyable.</p>
  <p>Then came social feeds. At first, they were fun. We got to see old friends and easily keep up with family. Over the years, that shifted. Now their algorithms show us more of what we’ve already read, pushing what makes us angriest to keep us scrolling.</p>
  <p>We’re old enough to know it doesn’t have to be that way. We remember the before times with a mix of nostalgia and hope. So we built <em>thicket</em> to bring the old way back.</p>
  <p>We’d love for like-minded people to join the effort to get back to community and sanity, if not with <em>thicket</em>, then however they enjoy staying connected to the world.</p>

  <section aria-labelledby="owners-h">
    <h2 id="owners-h">Who we are</h2>
    <ul class="owners">
      {#each owners as o (o.name)}
        <li>
          <img src={o.photo} alt="" width="1024" height="768" loading="lazy" />
          <div class="words">
            <h3>{o.name}</h3>
            <p>{o.background}</p>
            <p class="links">
              {#each o.links as l (l.href)}
                <a href={l.href} rel="noopener">
                  {#if l.icon === 'github'}
                    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" /></svg>
                  {/if}
                  <span>{l.label}</span>
                </a>
              {/each}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  </section>
</MarketingPage>

<style>
  /* Each of us gets a row: the photo, whole, beside the name, the background,
     and the links. The words get the wider share, so a background runs to a
     few lines and not a tall, thin column. A faint cream rule sits between
     the two rows. On a phone the photo goes on top. */
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; gap: var(--space-4); padding: var(--space-6) 0; }
  li:first-child { padding-top: var(--space-2); }
  li + li { border-top: 1px solid color-mix(in srgb, #f6f1e8 18%, transparent); }
  /* A hairline of cream and a soft shadow lift the photo off the green. */
  img {
    display: block; width: 100%; height: auto; border-radius: var(--radius); background: var(--forest-deep);
    box-shadow: 0 0 0 1px color-mix(in srgb, #f6f1e8 22%, transparent), 0 12px 32px rgba(0, 0, 0, 0.35);
  }
  /* The name in the headline face. */
  li .words h3 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 var(--space-3); }
  .words p { margin: 0; color: var(--forest-ink-2); }
  .words .links { margin-top: var(--space-4); display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
  /* The icon and its word share a line; only the word is underlined. */
  .links a { display: inline-flex; align-items: center; gap: var(--space-2); font-size: calc(var(--text-base) * var(--size-app)); text-decoration: none; }
  .links a span { text-decoration: underline; text-underline-offset: 3px; }
  .links svg { flex: none; }
  @media (min-width: 720px) {
    li { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: calc(var(--space-6) + var(--space-2)); align-items: center; }
  }
</style>
