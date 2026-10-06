<script lang="ts">
  /**
   * The tour's Profile picture: your own profile page in miniature, as you see
   * it, with your name and a line drawing of a reader at the top and each section's "Who sees
   * this" strip under its heading. Collections changes to People I follow;
   * Bookmarks starts below it, fading out, so the page reads as going on.
   */
  import { session } from '$lib/session.svelte';
  import SceneLoop from './SceneLoop.svelte';
  import MiniChoice from './MiniChoice.svelte';

  const me = $derived(session.user);
  const name = $derived(me?.displayName ?? me?.handle ?? 'You');
</script>

<SceneLoop round={7000}>
  <div class="page">
    <div class="who">
      <!-- A drawn reader, not your real picture: ink lines in the theme's own text color, the book in its accent. -->
      <svg class="pic" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
        <defs><clipPath id="intro-pic"><circle cx="32" cy="32" r="31" /></clipPath></defs>
        <circle cx="32" cy="32" r="31" fill="var(--surface)" />
        <g clip-path="url(#intro-pic)" fill="none" stroke="var(--text)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <g transform="translate(0 -3)"><!-- the whole figure sits a little high, so the book clears the frame -->
            <g transform="translate(0 -2)"><!-- body and book, up to a short neck -->
              <path d="M9 66c0-15 10-24.5 23-24.5S55 51 55 66" fill="var(--surface)" />
              <path d="M27.4 41.8l4.6 4.4 4.6-4.4" />
              <path d="M17 51.2l15 3.2 15-3.2v10.4l-15 3.2-15-3.2z" fill="var(--accent-tint)" stroke="var(--accent)" />
              <path d="M32 54.4v10.4" stroke="var(--accent)" />
              <path d="M20.4 55.2l8 1.7M20.4 58.2l8 1.7M35.6 56.9l8-1.7M35.6 59.9l8-1.7" stroke="var(--accent)" stroke-width="0.9" />
              <path d="M17 57.6c-2.2-.3-3-3-1.3-4.6M47 57.6c2.2-.3 3-3 1.3-4.6" />
            </g>
            <path d="M29.2 34.4v5.2M34.8 34.4v5.2" />
            <path d="M23.5 25.6c-1.7-.1-2.4 2.8-.4 3.6M40.5 25.6c1.7-.1 2.4 2.8.4 3.6" />
            <ellipse cx="32" cy="25.4" rx="8.6" ry="9.6" fill="var(--surface)" />
            <path d="M23.5 24.6c-1-7.6 3.2-12.6 8.9-12.6 5.9 0 9.8 4.7 8.6 12.3" />
            <path d="M24 20.4c4-.4 7.6-2.4 9.8-5.6 1.3 2.6 3.6 4.6 6.8 5.4" />
            <path d="M28.4 13.6c-1 1.4-1.6 2.6-1.8 4" stroke-width="1" />
            <circle cx="28.5" cy="26.2" r="2.6" stroke-width="1.1" />
            <circle cx="35.5" cy="26.2" r="2.6" stroke-width="1.1" />
            <path d="M31.1 26h1.8" stroke-width="1.1" />
            <path d="M27.5 26.8c.6.4 1.4.4 2 0M34.5 26.8c.6.4 1.4.4 2 0" stroke-width="1" />
            <path d="M30.6 31c.9.5 1.9.5 2.8 0" stroke-width="1.1" />
          </g>
        </g>
        <circle cx="32" cy="32" r="31" fill="none" stroke="var(--line)" stroke-width="1.5" />
      </svg>
      <div class="names">
        <span class="dn">{name}</span>
        {#if me}<span class="h">@{me.handle}</span>{/if}
        <span class="bio" aria-hidden="true"><span></span><span></span></span>
      </div>
    </div>

    <section style:--in="300ms">
      <p class="title">Collections <span class="count">2</span></p>
      <div class="panel">
        <div class="strip"><span class="label">Who sees this</span><MiniChoice from="Anyone" to="People I follow" at={2000} /></div>
        <div class="row"><span>Cooking</span><span class="feeds">3 feeds ›</span></div>
        <div class="row"><span>Tech</span><span class="feeds">3 feeds ›</span></div>
      </div>
    </section>

    <section style:--in="450ms">
      <p class="title">Bookmarks <span class="count">12</span></p>
    </section>
  </div>
</SceneLoop>

<style>
  .page { width: min(360px, 88%); margin: var(--space-4) auto 0; background: var(--bg); border-radius: var(--radius-sm); box-shadow: var(--shadow); border: var(--card-border, 0); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); }
  .who { display: flex; align-items: flex-start; gap: var(--space-2); padding-bottom: var(--space-3); border-bottom: 1px solid var(--line); }
  .pic { flex: none; display: block; }
  .names { display: flex; flex-direction: column; flex: 1; line-height: 1.2; }
  .dn { font-family: var(--font-headings); font-weight: 700; font-size: 16px; color: var(--text); }
  .h { font-size: 10px; color: var(--text-2); }
  /* The bio, as two soft lines: the words would be yours, so the picture doesn't make any up. */
  .bio { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .bio span { height: 3px; border-radius: 2px; background: var(--line); }
  .bio span:last-child { width: 60%; }
  section { display: flex; flex-direction: column; gap: 4px; animation: rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--in) backwards; }
  .title { margin: 0; font-size: 12px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 4px; }
  .count { font-size: 9px; font-weight: 600; padding: 0 5px; border-radius: var(--radius-pill); background: var(--surface-2); color: var(--text-2); }
  .panel { background: var(--surface); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow); border: var(--card-border, 0); }
  .strip { display: flex; align-items: center; gap: var(--space-2); padding: 5px var(--space-2); background: var(--panel); flex-wrap: wrap; }
  .label { font-size: 10px; font-weight: 600; color: var(--text-2); }
  .row { display: flex; justify-content: space-between; padding: 5px var(--space-2); font-size: 11px; font-weight: 600; color: var(--text); border-top: 1px solid var(--line); }
  .feeds { font-weight: 400; color: var(--text-2); }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
</style>
