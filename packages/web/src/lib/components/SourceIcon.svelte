<script lang="ts">
  /**
   * A feed's visual identity: the site's real icon when it passed our quality
   * bar (cached server-side), otherwise a monogram. If the icon fails to load
   * (a proxy throttling a page full of icons, say) it is retried once after a
   * short, jittered pause; after that the monogram takes over, never a broken
   * image.
   */
  import { iconUrl } from '$lib/api';
  import Monogram from './Monogram.svelte';
  let { feedId, hasIcon = false, name, size = 22 }: { feedId: number | null; hasIcon?: boolean; name: string | null; size?: number } = $props();
  let failed = $state(false);
  let attempt = $state(0);
  function onerror() {
    if (attempt === 0) setTimeout(() => (attempt = 1), 700 + Math.random() * 900);
    else failed = true;
  }
  const src = $derived(feedId === null ? '' : attempt ? `${iconUrl(feedId)}?retry=${attempt}` : iconUrl(feedId));
</script>

{#if hasIcon && feedId !== null && !failed}
  <img class="icon" {src} alt="" width={size} height={size} loading="lazy" decoding="async" {onerror} style:--s="{size}px" />
{:else}
  <Monogram {name} {size} />
{/if}

<style>
  .icon {
    width: var(--s); height: var(--s); flex: none; border-radius: 30%; object-fit: cover;
    background: var(--surface-2); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }
</style>
