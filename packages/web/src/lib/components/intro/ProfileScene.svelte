<script lang="ts">
  /**
   * The tour's Profile picture: your own profile page in miniature, as you see
   * it, with your name and a drawn person at the top and each section's "Who sees
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
      <!-- A drawn person, not your real picture: the picture stands for anyone's profile. -->
      <svg class="pic" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <rect width="40" height="40" rx="10" fill="color-mix(in srgb, var(--accent) 20%, var(--surface))" />
        <path d="M7 40c0-8.5 5.8-12.6 13-12.6S33 31.5 33 40z" fill="var(--accent)" />
        <rect x="17.7" y="22" width="4.6" height="6.4" rx="2.2" fill="var(--surface)" stroke="var(--text)" stroke-opacity="0.15" />
        <circle cx="20" cy="17.2" r="7.4" fill="var(--surface)" stroke="var(--text)" stroke-opacity="0.15" />
        <path d="M12.5 16.6c-.2-5.2 3.3-8.4 7.7-8.4 4.7 0 7.7 3.3 7.4 7.8-3-.1-6.4-1.3-8.7-3.6-1.3 2.2-3.6 3.8-6.4 4.2z" fill="var(--text)" fill-opacity="0.78" />
        <circle cx="17.3" cy="18" r="0.85" fill="var(--text)" />
        <circle cx="22.7" cy="18" r="0.85" fill="var(--text)" />
        <path d="M17.8 20.9c1.3 1 3.1 1 4.4 0" fill="none" stroke="var(--text)" stroke-width="1.1" stroke-linecap="round" />
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
