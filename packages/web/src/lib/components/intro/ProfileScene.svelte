<script lang="ts">
  /**
   * The tour's Profile picture: your own page in miniature, with your own name
   * and picture, and the "Who sees" choice beside each part changing as you
   * watch: bookmarks to People I follow, notes to Only me.
   */
  import { MENU_ICONS } from '$lib/menu-icons';
  import { session } from '$lib/session.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import SceneLoop from './SceneLoop.svelte';
  import Swap from './Swap.svelte';

  const me = $derived(session.user);
  const PARTS = [
    { label: 'Collections', icon: MENU_ICONS.collections, to: 'Anyone' },
    { label: 'Bookmarks', icon: MENU_ICONS.bookmarks, to: 'People I follow', at: 2300 },
    { label: 'Notes', icon: 'M4 20h4L18.5 9.5l-4-4L4 16v4z', to: 'Only me', at: 3300 }
  ];
</script>

<SceneLoop round={7000}>
  <div class="page">
    <div class="me">
      {#if me}<Avatar handle={me.handle} name={me.displayName ?? me.handle} size={36} v={me.avatarUpdatedAt} />{/if}
      <span class="names"><span class="dn">{me?.displayName ?? me?.handle ?? 'You'}</span>{#if me}<span class="h">@{me.handle}</span>{/if}</span>
    </div>
    {#each PARTS as p, i (p.label)}
      <div class="part" style:--in="{300 + i * 140}ms" style:--at="{p.at ?? 0}ms">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={p.icon} /></svg>
        <span class="label">{p.label}</span>
        <span class="who" class:changes={p.at}>{#if p.at}<Swap from="Anyone" to={p.to} at={p.at} />{:else}{p.to}{/if}</span>
      </div>
    {/each}
  </div>
</SceneLoop>

<style>
  .page { width: min(340px, 86%); margin: var(--space-5) auto 0; background: var(--surface); border-radius: var(--radius-sm); box-shadow: var(--shadow); border: var(--card-border, 0); padding: var(--space-3); display: flex; flex-direction: column; gap: 6px; }
  .me { display: flex; align-items: center; gap: var(--space-2); padding-bottom: var(--space-2); margin-bottom: 2px; border-bottom: 1px solid var(--line); }
  .names { display: flex; flex-direction: column; line-height: 1.25; }
  .dn { font-family: var(--font-headings); font-weight: 600; font-size: 15px; color: var(--text); }
  .h { font-size: 11px; color: var(--text-2); }
  .part { display: flex; align-items: center; gap: var(--space-2); padding: 6px 4px; font-size: 12px; color: var(--text); animation: rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--in) backwards; }
  .part svg { color: var(--text-2); flex: none; }
  .label { font-weight: 600; }
  .who { margin-left: auto; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--surface-2); font-size: 10px; font-weight: 600; color: var(--text-2); white-space: nowrap; }
  /* The one that changes flashes the accent as it does. */
  .who.changes { animation: flash 900ms ease-out var(--at) backwards; }
  @keyframes flash { from { background: var(--accent); color: var(--accent-ink); } }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
</style>
