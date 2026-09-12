<script lang="ts">
  /**
   * Write or rewrite my note on a post, in place under the card. Markdown,
   * capped at NOTE_MAX. Save writes; Cancel (or Escape) puts back what was
   * there; Delete removes the note. Nothing is saved until Save.
   */
  import { api, notesApi, NOTE_MAX, type Note } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';

  let { itemId, note = null, onsaved, ondeleted, oncancel }: {
    itemId: number; note?: Note | null;
    onsaved: (n: Note) => void; ondeleted: () => void; oncancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let body = $state(note?.body ?? '');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let box = $state<HTMLTextAreaElement | null>(null);
  const dirty = $derived(body.trim() !== (note?.body ?? ''));
  const over = $derived(body.length > NOTE_MAX);

  $effect(() => { box?.focus(); });

  async function save() {
    if (busy || !body.trim() || over) return;
    busy = true; error = null;
    try {
      const saved = await notesApi.write(itemId, body);
      api.event(note ? 'note_edited' : 'note_written', { itemId, length: saved.body.length });
      onsaved(saved);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (busy || !note) return;
    if (!confirm('Delete this note?')) return;
    busy = true;
    try {
      await notesApi.remove(itemId);
      api.event('note_deleted', { itemId });
      showToast('Note deleted');
      ondeleted();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<form class="editor" onsubmit={(e) => { e.preventDefault(); void save(); }}>
  <div class="head">{note ? 'Edit my note' : 'My note'}</div>
  <textarea bind:this={box} bind:value={body} rows="4" maxlength={NOTE_MAX + 200} placeholder="What do you want to remember about this? Markdown works: **bold**, *italic*, [links](https://…), - lists."
    disabled={busy} onkeydown={(e) => { if (e.key === 'Escape') oncancel(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}></textarea>
  <div class="row">
    <button type="submit" class="btn primary" disabled={busy || !dirty || !body.trim() || over}>{busy ? 'Saving…' : 'Save'}</button>
    <button type="button" class="btn" onclick={oncancel} disabled={busy}>Cancel</button>
    {#if note}<button type="button" class="btn danger" onclick={remove} disabled={busy}>Delete</button>{/if}
    <span class="counter" class:over class:near={!over && body.length > NOTE_MAX - 200}>{body.length}/{NOTE_MAX}</span>
  </div>
  {#if error}<p class="bad" role="alert">{error}</p>{/if}
</form>

<style>
  .editor { border-top: 1px solid var(--line); padding: 10px 16px 12px; background: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
  .head { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); margin-bottom: 6px; }
  textarea { width: 100%; font: inherit; font-size: 14px; line-height: 1.5; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--text); resize: vertical; }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .btn { padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-2); }
  .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .btn.danger { color: var(--danger); margin-left: auto; }
  .btn:disabled { opacity: 0.5; }
  .counter { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .btn.danger + .counter { margin-left: 0; }
  .row:not(:has(.danger)) .counter { margin-left: auto; }
  .counter.near { color: var(--text-2); }
  .counter.over { color: var(--danger); font-weight: 700; }
  .bad { margin: 6px 0 0; font-size: 13px; color: var(--danger); }
</style>
