<script lang="ts">
  import { toast, dismissToast } from '$lib/toast.svelte';

  /* An open Sheet sits above everything the page can stack, and the browser
     ignores clicks outside it, so an ordinary toast would land behind it and
     its Undo couldn't be pressed (and a "couldn't save" message would go
     unseen). While a Sheet is open the toast moves inside it; when that Sheet
     closes the toast moves back to the page, so a toast raised by closing
     (Unfollow does this) outlives the Sheet. */
  function onTop(el: HTMLElement, _id: number) {
    const home = el.parentElement!;
    const place = () => {
      const sheet = [...document.querySelectorAll('dialog')].filter((d) => d.matches(':modal')).pop();
      (sheet ?? home).appendChild(el);
    };
    const onClose = (e: Event) => { if ((e.target as Node).contains(el)) home.appendChild(el); };
    place();
    document.addEventListener('close', onClose, true);
    return { update: place, destroy: () => document.removeEventListener('close', onClose, true) };
  }
</script>

{#if toast.current}
  <div class="toast" role="status" use:onTop={toast.current.id}>
    <span>{toast.current.message}</span>
    {#if toast.current.action}
      <button class="action" onclick={() => { toast.current?.action?.run(); dismissToast(); }}>{toast.current.action.label}</button>
    {/if}
  </div>
{/if}

<style>
  .toast {
    position: fixed; left: 50%; bottom: calc(var(--nav-h) + var(--safe-b) + var(--space-3)); transform: translateX(-50%);
    display: flex; align-items: center; gap: var(--space-4); max-width: min(92vw, 520px);
    background: var(--text); color: var(--bg); padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm);
    box-shadow: var(--shadow); font-size: calc(var(--text-base) * var(--size-app)); z-index: 50;
  }
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) { .toast { bottom: var(--space-5); } }
  /* The toast is an inverted chip, so the action word uses the toast color the
     theme picked for that ground, not the page accent (which lands on its own
     background here and disappears). */
  .action { color: var(--toast-accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
