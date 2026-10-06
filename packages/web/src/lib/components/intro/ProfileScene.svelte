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
      <!-- A drawn reader, not your real picture: ink on paper in the theme's light colors, the book in its accent. -->
      <svg class="pic" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
        <defs><clipPath id="intro-pic"><circle cx="32" cy="32" r="31" /></clipPath></defs>
        <circle cx="32" cy="32" r="31" fill="var(--paper)" />
        <g clip-path="url(#intro-pic)" fill="none" stroke="var(--ink)" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
          <g transform="translate(32 16.4) scale(1.3) translate(-32 -19.4)"><!-- zoomed in: head and shoulders fill the frame, and the frame crops the book to its top edge -->
            <g transform="translate(0 -3.5)"><!-- shoulders and arms, and the book held against the chest -->
              <path d="M14.5 66V53.6c0-5.4 3.2-9.2 8.4-10.6l5.4-1.4h7.4l5.4 1.4c5.2 1.4 8.4 5.2 8.4 10.6V66" fill="var(--paper)" />
              <path d="M27.4 41.8l4.6 4.4 4.6-4.4" />
              <g transform="translate(0 -3)"><!-- the book, raised so its top edge and first lines show -->
                <path d="M17 51.2l15 3.2 15-3.2v10.4l-15 3.2-15-3.2z" fill="color-mix(in srgb, var(--leaf) 12%, var(--paper))" stroke="var(--leaf)" />
                <path d="M32 54.4v10.4" stroke="var(--leaf)" />
                <path d="M20.4 55.2l8 1.7M20.4 58.2l8 1.7M35.6 56.9l8-1.7M35.6 59.9l8-1.7" stroke="var(--leaf)" stroke-width="0.9" />
              </g>
            </g>
            <path d="M29.2 34.4v3.7M34.8 34.4v3.7" />
            <path d="M23.5 25.6c-1.7-.1-2.4 2.8-.4 3.6M40.5 25.6c1.7-.1 2.4 2.8.4 3.6" />
            <ellipse cx="32" cy="25.4" rx="8.6" ry="9.6" fill="var(--paper)" />
            <!-- Hair: one shape, a soft tone of the ink, parted on the right and swept across. -->
            <path d="M23.3 26.4C21.6 16.8 26.2 11.4 32.4 11.4c6.4 0 10.6 5.2 8.4 15C40.4 19.6 37.6 17.4 35.4 17.2 33.2 17 27.4 20.4 23.3 26.4z" fill="color-mix(in srgb, var(--ink) 24%, var(--paper))" />
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
  /* The drawing keeps the theme's light colors in dark mode too, ink on paper
     like a printed illustration: inverted, light lines on a dark face read as a negative. */
  .pic { flex: none; display: block; --paper: var(--l-surface); --ink: var(--l-text); --leaf: var(--l-accent); }
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
