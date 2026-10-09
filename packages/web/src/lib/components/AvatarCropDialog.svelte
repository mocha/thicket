<script lang="ts">
  /**
   * Pick-a-spot cropper for a new profile picture. It opens on the file the
   * person chose, lets them drag to reposition and zoom, then sends the square
   * they framed.
   *
   * Dragging is never the only way: four arrow buttons move the photo a step
   * at a time, for anyone using a keyboard or who can't hold and drag, and the
   * slider does the zooming. It is a Sheet, so focus moves into it, stays in
   * it, and goes back to where it was when it closes; Escape cancels, except
   * while the photo is saving.
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
  import IconButton from './IconButton.svelte';
  import Sheet from './Sheet.svelte';

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
  let dialog = $state<HTMLDialogElement | null>(null);
  let stage = $state<HTMLElement | null>(null);

  $effect(() => { dialog?.showModal(); });

  /**
   * One press of an arrow. The photo can't be pushed so far that the circle
   * runs off its edge — the same limit dragging has, worked out from the
   * photo and the circle as drawn.
   */
  const STEP = 16;
  function nudge(dx: number, dy: number) {
    const img = stage?.querySelector<HTMLImageElement>('.svelte-easy-crop-image');
    const ring = stage?.querySelector<HTMLElement>('.svelte-easy-crop-area');
    if (!img || !ring) return;
    const maxX = Math.max(0, (img.width * zoom - ring.offsetWidth) / 2);
    const maxY = Math.max(0, (img.height * zoom - ring.offsetHeight) / 2);
    const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v));
    crop = { x: clamp(crop.x + dx * STEP, maxX), y: clamp(crop.y + dy * STEP, maxY) };
  }

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
      // Closed first, so focus goes back to where it was before the dialog is taken away.
      dialog?.close();
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

<Sheet title="Position your photo" lede="Drag or use the arrows to move, and pinch or use the slider to zoom. What’s in the circle is your picture." bind:dialog {onclose} locked={saving}>
  <div class="stage" bind:this={stage}>
    {#if Cropper}
      <Cropper image={url} bind:crop bind:zoom aspect={1} cropShape="round" showGrid={false} oncropcomplete={(e: { pixels: typeof area }) => (area = e.pixels)} />
    {:else if loadError}
      <p class="status">Couldn’t load the cropper. Check your connection and try again.</p>
    {:else}
      <p class="status">Preparing…</p>
    {/if}
  </div>

  <div class="ctrl" role="group" aria-label="Move photo">
    <span aria-hidden="true">Move</span>
    <div class="arrows">
      <IconButton icon="caret" dir="left" variant="bordered" label="Move photo left" disabled={!Cropper} onclick={() => nudge(-1, 0)} />
      <IconButton icon="caret" dir="up" variant="bordered" label="Move photo up" disabled={!Cropper} onclick={() => nudge(0, -1)} />
      <IconButton icon="caret" dir="down" variant="bordered" label="Move photo down" disabled={!Cropper} onclick={() => nudge(0, 1)} />
      <IconButton icon="caret" dir="right" variant="bordered" label="Move photo right" disabled={!Cropper} onclick={() => nudge(1, 0)} />
    </div>
  </div>

  <label class="ctrl">
    <span>Zoom</span>
    <input type="range" min="1" max="3" step="0.01" bind:value={zoom} disabled={!Cropper} />
  </label>

  {#snippet footer()}
    <button type="button" class="sheet-action" onclick={save} disabled={saving || !area}>{saving ? 'Saving…' : 'Save photo'}</button>
  {/snippet}
</Sheet>

<style>
  /* The cropper fills this box; it needs an explicit height to lay itself out, and keeps it when the Sheet is short. */
  .stage { position: relative; flex: none; width: 100%; height: 300px; border-radius: var(--radius-md); overflow: hidden; background: var(--bg); }
  .status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: 0 var(--space-4); text-align: center; }
  /* Move and Zoom: a name on the left, its control after it, the two names the same width so the controls line up. */
  .ctrl { display: flex; align-items: center; gap: var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .ctrl > span { flex: none; width: 3.2em; }
  .ctrl input { flex: 1; accent-color: var(--accent); }
  .arrows { display: flex; gap: var(--space-2); }
</style>
