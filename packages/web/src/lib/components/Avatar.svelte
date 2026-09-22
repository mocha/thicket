<script lang="ts">
  /**
   * A person's face. The monogram is always drawn as the base; when the person
   * has a picture, it's laid over the top. So while the image loads — or if it
   * ever fails — the monogram shows through, and we never flash an empty box.
   *
   * `v` is the person's avatarUpdatedAt: passing it both tells us there's a
   * picture to fetch and busts the browser cache the moment they change it.
   */
  import { avatarUrl } from '$lib/api';
  import Monogram from './Monogram.svelte';

  let { handle, name, size = 22, v = null }: { handle: string; name: string | null; size?: number; v?: string | null } = $props();

  // Give up on the image if it errors, so a broken picture falls back cleanly.
  let failed = $state(false);
  const src = $derived(v ? avatarUrl(handle, v) : null);
  // A new address (they changed their picture) is worth another try.
  $effect(() => { void src; failed = false; });
</script>

<span class="avatar" style:--s="{size}px">
  <Monogram {name} {size} />
  {#if src && !failed}
    <img class="pic" {src} alt="" aria-hidden="true" loading="lazy" onerror={() => (failed = true)} />
  {/if}
</span>

<style>
  .avatar { position: relative; display: inline-grid; width: var(--s); height: var(--s); flex: none; }
  /* The monogram sits in the same grid cell so the box is exactly one avatar wide. */
  .avatar :global(.mono) { grid-area: 1 / 1; }
  .pic {
    grid-area: 1 / 1; position: absolute; inset: 0;
    width: 100%; height: 100%; border-radius: var(--radius-avatar);
    object-fit: cover; background: var(--surface-2);
  }
</style>
