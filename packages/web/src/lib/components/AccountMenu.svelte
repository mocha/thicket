<script lang="ts">
  /**
   * The account menu: three plain doors that used to be scattered. Your
   * profile (your public page), Settings (your private preferences), and Log
   * out — which used to hide at the bottom of Settings.
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

  let { anchor, onclose }: { anchor: HTMLElement | null; onclose: () => void } = $props();

  const me = $derived(session.user);
  let panel = $state<HTMLElement | null>(null);
  let sheet = $state(false);
  let pos = $state<{ top: number; left: number }>({ top: 0, left: 0 });

  const WIDTH = 240;
  function place() {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    // The trigger sits low, so the menu grows upward from its top edge.
    pos = { top: r.top - 8, left };
  }

  $effect(() => {
    sheet = !window.matchMedia('(min-width: 900px)').matches;
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
      <span>My profile</span>
    </a>
    <a role="menuitem" href="/settings" onclick={onclose}>
      <Icon name="gear" size={20} />
      <span>Settings</span>
    </a>
    <button type="button" role="menuitem" class="out" onclick={logout}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 12H4M11 8l-4 4 4 4M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /></svg>
      <span>Log out</span>
    </button>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 59; background: rgba(0, 0, 0, 0.4); }
  .panel {
    position: fixed; z-index: 60; width: 240px; max-width: calc(100vw - 16px);
    background: var(--surface); color: var(--text); border-radius: 14px; padding: 6px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--line);
    display: flex; flex-direction: column;
  }
  .panel.sheet {
    top: auto; left: 0; right: 0; bottom: 0; width: auto; max-width: none;
    border-radius: 20px 20px 0 0; padding: 12px 12px calc(12px + var(--safe-b));
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.25);
  }
  .who { display: flex; align-items: center; gap: 12px; padding: 8px 10px 12px; border-bottom: 1px solid var(--line); margin-bottom: 6px; }
  .names { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
  .dn { font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel a, .panel button {
    display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 10px; border-radius: 10px;
    font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text-2); text-align: left;
  }
  .panel a:hover, .panel button:hover { background: var(--surface-2); }
  .panel svg { flex: none; color: var(--text-3); }
  .panel .out { color: var(--danger); }
  .panel .out svg { color: var(--danger); }
</style>
