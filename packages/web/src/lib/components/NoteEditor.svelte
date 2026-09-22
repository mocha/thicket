<script lang="ts">
  /**
   * Write or rewrite my note on a post, in place under the card. Markdown,
   * capped at NOTE_MAX. Save writes; Cancel (or Escape) puts back what was
   * there; Delete removes the note. Nothing is saved until Save.
   *
   * The box accepts a little more than the cap on purpose, so running long
   * shows you by how much instead of stopping your typing dead. Save stays off
   * while you are over.
   */
  import { api, notesApi, NOTE_MAX, type Note } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Textarea from '$lib/components/Textarea.svelte';

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

  /** Cmd/Ctrl+Enter saves without reaching for the button; Escape backs out. */
  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape') oncancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  }

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
  <Field label={note ? 'Edit my note' : 'My note'} {error}>
    {#snippet children({ id, describedBy, invalid })}
      <Textarea
        {id}
        aria-describedby={describedBy}
        {invalid}
        bind:element={box}
        bind:value={body}
        rows={4}
        maxlength={NOTE_MAX + 200}
        limit={NOTE_MAX}
        counter
        disabled={busy}
        placeholder="What do you want to remember about this? Markdown works: **bold**, *italic*, [links](https://…), - lists."
        onkeydown={keys}
      />
    {/snippet}
  </Field>
  <div class="row">
    <Button type="submit" variant="primary" disabled={busy || !dirty || !body.trim() || over}>{busy ? 'Saving…' : 'Save'}</Button>
    <Button onclick={oncancel} disabled={busy}>Cancel</Button>
    {#if note}<Button variant="danger" onclick={remove} disabled={busy} style="margin-left: auto">Delete</Button>{/if}
  </div>
</form>

<style>
  .editor { border-top: 1px solid var(--line); padding: 10px 16px 12px; background: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
</style>
