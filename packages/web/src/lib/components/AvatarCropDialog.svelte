<script lang="ts">
  /**
   * Pick-a-spot cropper for a new profile picture. It opens on the file the
   * person chose, lets them drag to reposition and zoom, then sends the square
   * they framed.
   *
   * The cropping library is loaded only once this dialog opens (a dynamic
   * import), so it never weighs down the rest of the app — most people never
   * change their picture. While it downloads, we show a short "Preparing…".
   *
   * We still hand the server a square it re-encodes; the crop here is about what
   * the person sees, not trust.
   */
  import type { Component } from 'svelte';
  import { authApi, ApiError } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';

  let { file, onclose, onsaved }: { file: File; onclose: () => void; onsaved: (avatarUpdatedAt: string) => void } = $props();

  // The chosen image, as an address the cropper and the canvas can both read.
  // Made once the dialog mounts and revoked when it closes.
  let url = $state('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Cropper = $state<Component<any> | null>(null);
  let loadError = $state(false);
  let crop = $state({ x: 0, y: 0 });
  let zoom = $state(1);
  // The framed square, in the source image's own pixels. Set as they drag.
  let area = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let saving = $state(false);

  $effect(() => {
    const u = URL.createObjectURL(file);
    url = u;
    // Load the cropper only now that someone is actually cropping.
    import('svelte-easy-crop')
      .then((m) => (Cropper = m.default))
      .catch(() => (loadError = true));
    return () => URL.revokeObjectURL(u);
  });

  /** Draw the framed square onto a canvas and hand back small WebP bytes. */
  function croppedBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!area) return reject(new Error('no-area'));
      const img = new Image();
      img.onload = () => {
        // Cap the upload; the server shrinks to 256 anyway, so 512 is plenty.
        const out = Math.min(512, Math.round(area!.width));
        const canvas = document.createElement('canvas');
        canvas.width = out; canvas.height = out;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no-canvas'));
        ctx.drawImage(img, area!.x, area!.y, area!.width, area!.height, 0, 0, out, out);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no-blob'))), 'image/webp', 0.9);
      };
      img.onerror = () => reject(new Error('bad-image'));
      img.src = url;
    });
  }

  async function save() {
    if (saving || !area) return;
    saving = true;
    try {
      const blob = await croppedBlob();
      const { avatarUpdatedAt } = await authApi.uploadAvatar(blob);
      onsaved(avatarUpdatedAt);
    } catch (e) {
      // A dropped session is the picture's fault, not the person's — say so.
      if (e instanceof ApiError && e.status === 401) showToast('Your session expired. Sign in again, then retry.');
      // The server sends its own words for a bad or oversized file; trust them.
      else if (e instanceof ApiError) showToast(e.message);
      else showToast('Couldn’t save that picture. Try another.');
      saving = false;
    }
  }
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Position your photo">
  <h2>Position your photo</h2>
  <p class="help">Drag to move, and pinch or use the slider to zoom. What’s in the circle is your picture.</p>

  <div class="stage">
    {#if Cropper}
      <Cropper image={url} bind:crop bind:zoom aspect={1} cropShape="round" showGrid={false} oncropcomplete={(e: { pixels: typeof area }) => (area = e.pixels)} />
    {:else if loadError}
      <p class="status">Couldn’t load the cropper. Check your connection and try again.</p>
    {:else}
      <p class="status">Preparing…</p>
    {/if}
  </div>

  <label class="zoom">
    <span>Zoom</span>
    <input type="range" min="1" max="3" step="0.01" bind:value={zoom} disabled={!Cropper} />
  </label>

  <div class="row">
    <button type="button" class="ghost" onclick={onclose} disabled={saving}>Cancel</button>
    <button type="button" class="save" onclick={save} disabled={saving || !area}>{saving ? 'Saving…' : 'Save photo'}</button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 70; background: rgba(0, 0, 0, 0.5); }
  .panel {
    position: fixed; z-index: 71; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
    background: var(--surface); color: var(--text); border-radius: 18px; padding: 18px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--line);
  }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0 0 6px; }
  .help { margin: 0 0 14px; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); line-height: 1.4; }
  /* The cropper fills this box; it needs an explicit height to lay itself out. */
  .stage { position: relative; width: 100%; height: 300px; border-radius: 14px; overflow: hidden; background: var(--bg); }
  .status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); padding: 0 16px; text-align: center; }
  .zoom { display: flex; align-items: center; gap: 12px; margin: 14px 0 4px; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .zoom input { flex: 1; accent-color: var(--accent); }
  .row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
  button { padding: 10px 16px; border-radius: 999px; border: 1px solid var(--line); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .ghost { color: var(--text-2); background: var(--surface); }
  .save { color: #fff; background: var(--accent); border-color: transparent; }
  button:disabled { opacity: 0.5; }
</style>
