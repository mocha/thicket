<script lang="ts">
  /**
   * The account menu: plain doors. Notifications first wherever the bottom
   * bar is the navigation (a phone, or the paged layout): the bar has no room
   * for it, so it lives here with its count, and the You tab shows a dot.
   * My page (the page at your address, showing what you share),
   * Settings (your reading preferences), and Account (your email and password —
   * how you get in, and back in; importing and exporting live there too).
   * An admin also gets Admin here wherever the bottom bar is the navigation (a
   * phone, or the paged layout), because the sidebar that holds it isn't there.
   * Then Send feedback (readthicket.com only), which opens a sheet rather than
   * a page, and under a line of its own, Log out.
   *
   * On desktop it hangs off the avatar block at the foot of the sidebar,
   * opening upward from it, the way an account menu should. On the phone, where
   * it opens from the "You" tab in the bottom bar, it rises as a bottom sheet —
   * the phone-native shape. It positions itself from whichever element opened
   * it, the same trick the Follow menu uses.
   */
  import { goto } from '$app/navigation';
  import { authApi, profileHref } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { navWidth } from '$lib/navwidth.svelte';
  import { display } from '$lib/display.svelte';
  import { menu } from '$lib/menu';
  import { site, loadSite } from '$lib/site.svelte';
  import { openFeedback } from '$lib/feedback.svelte';
  import { notifText } from '$lib/notifications.svelte';
  import Badge from './Badge.svelte';

  let { anchor, onclose }: { anchor: HTMLElement | null; onclose: () => void } = $props();

  const me = $derived(session.user);
  $effect(() => { if (!site.status) void loadSite(); });
  const hosted = $derived(site.status?.hosted ?? false);
  let panel = $state<HTMLElement | null>(null);
  let sheet = $state(false);
  let pos = $state<{ top: number; left: number }>({ top: 0, left: 0 });

  function place() {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    // The panel is as wide as the sidebar (--nav-w draws it); this keeps it on screen.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - navWidth.px - 8));
    // The trigger sits low, so the menu grows upward from its top edge.
    pos = { top: r.top - 8, left };
  }

  $effect(() => {
    // The same condition the sidebar appears under; see Nav.svelte.
    sheet = !window.matchMedia('(min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine)').matches;
    if (!sheet) place();
    const onDoc = (e: MouseEvent) => { if (!panel?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onclose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onclose(); };
    const reflow = () => { if (!sheet) place(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
  });

  /**
   * Leave first, then forget the user and go home. Home is the one public page,
   * so a signed-out person lands on the front door rather than a login redirect.
   */
  async function logout() {
    onclose();
    try {
      await authApi.logout();
      await goto('/', { replaceState: true });
      setMe(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }
</script>

{#if me}
  {#if sheet}<div class="scrim" aria-hidden="true"></div>{/if}
  <div
    class="panel"
    class:sheet
    bind:this={panel}
    use:menu={{ anchor, onclose, modal: sheet }}
    role="menu"
    aria-label="Account"
    style:top={sheet ? undefined : `${pos.top}px`}
    style:left={sheet ? undefined : `${pos.left}px`}
    style:transform={sheet ? undefined : 'translateY(-100%)'}
  >
    {#if sheet}
      <div class="who">
        <Avatar handle={me.handle} name={me.displayName ?? me.handle} size={40} v={me.avatarUpdatedAt} />
        <span class="names"><span class="dn">{me.displayName ?? me.handle}</span><span class="h">@{me.handle}</span></span>
      </div>
    {/if}
    <a role="menuitem" href={profileHref(me.handle)} onclick={onclose}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
      <span>My page</span>
    </a>
    {#if sheet || display.layout === 'paged'}
      <a role="menuitem" href="/notifications" onclick={onclose}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9M10 20.5a2.2 2.2 0 0 0 4 0" /></svg>
        <span>Notifications</span>
        {#if notifText()}<Badge tone="accent" class="tail" aria-label="{notifText()} new">{notifText()}</Badge>{/if}
      </a>
    {/if}
    <a role="menuitem" href="/settings" onclick={onclose}>
      <Icon name="gear" size={20} />
      <span>Settings</span>
    </a>
    <a role="menuitem" href="/account" onclick={onclose}>
      <Icon name="key" size={20} />
      <span>Account</span>
    </a>
    {#if me.isAdmin && (sheet || display.layout === 'paged')}
      <a role="menuitem" href="/admin" onclick={onclose}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /></svg>
        <span>Admin</span>
      </a>
    {/if}
    {#if hosted}
      <button type="button" role="menuitem" onclick={() => { onclose(); openFeedback(); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
        <span>Send feedback</span>
      </button>
    {/if}
    <div class="rule" role="separator"></div>
    <button type="button" role="menuitem" class="out" onclick={logout}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 12H4M11 8l-4 4 4 4M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /></svg>
      <span>Log out</span>
    </button>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 59; background: var(--scrim); }
  .panel {
    position: fixed; z-index: 60; width: var(--nav-w); max-width: calc(100vw - 16px);
    background: var(--surface); color: var(--text); border-radius: var(--radius-md); padding: var(--space-2);
    box-shadow: var(--shadow-menu);
    display: flex; flex-direction: column;
  }
  .panel.sheet {
    top: auto; left: 0; right: 0; bottom: 0; width: auto; max-width: none;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: var(--space-3) max(var(--space-3), env(safe-area-inset-right, 0px)) calc(var(--space-3) + var(--safe-b)) max(var(--space-3), env(safe-area-inset-left, 0px));
    box-shadow: var(--shadow-sheet);
  }
  .who { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3) var(--space-3); border-bottom: 1px solid var(--line); margin-bottom: var(--space-2); }
  .names { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
  .dn { font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel a, .panel button {
    display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-3); border-radius: var(--radius-sm);
    font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text-2); text-align: left;
  }
  /* Only where there's a pointer: on a touchscreen the tap that opens the menu
     lands where Log out appears, and would leave it looking selected. */
  @media (hover: hover) { .panel a:hover, .panel button:hover { background: var(--surface-2); } }
  .panel svg { flex: none; color: var(--text-3); }
  /* Notifications' count, at the row's end. */
  .panel :global(.tail) { margin-left: auto; }
  /* The line that sets Log out apart from everything above it. */
  .rule { height: 1px; background: var(--line); margin: var(--space-2) var(--space-3); }
  .panel .out { color: var(--danger); }
  .panel .out svg { color: var(--danger); }
</style>
