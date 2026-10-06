<script lang="ts">
  /**
   * The tour's Profile picture: a profile page in miniature, with a sample
   * name and a hand-drawn person at the top (never the reader's own name;
   * the picture stands for anyone's profile) and each
   * section's "Who sees this" strip under its heading. Collections changes
   * to People I follow; Bookmarks starts below it, fading out, so the page
   * reads as going on.
   */
  import SceneLoop from './SceneLoop.svelte';
  import MiniChoice from './MiniChoice.svelte';
</script>

<SceneLoop round={7000}>
  <div class="page">
    <div class="who">
      <!-- A hand-drawn person, not your real picture: the picture stands for anyone's profile. -->
      <img class="pic" src="/intro/reader.webp?v=3" alt="" width="52" height="52" />
      <div class="names">
        <span class="dn">Robin Ellis</span>
        <span class="h">@robin</span>
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
  .pic { flex: none; display: block; border-radius: 50%; border: 1.5px solid var(--line); background: #fff; }
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
