<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  /**
   * Write or rewrite my note on a post, in place under the card. Markdown,
   * capped at NOTE_MAX. Save writes; Cancel (or Escape) puts back what was
   * there; Delete removes the note. Nothing is saved until Save.
   *
   * The box accepts a little more than the cap on purpose, so running long
   * shows you by how much instead of stopping your typing dead. Save stays off
   * while you are over.
   *
   * The note belongs to a post (`itemId`) wherever there is one; saving it
   * saves the post too. A bookmark whose post is gone is noted through the
   * bookmark instead (`bookmarkId`).
   *
   * Typing `@` suggests people to mention (issue #184): the people I follow,
   * matched on handle or name (lib/mentions.ts). Up and Down move through them,
   * Enter or Tab puts the handle in, Escape closes the list without leaving
   * the note. The box is an ARIA combobox and the suggestions its listbox, so
   * a screen reader hears each one as it is highlighted. Mentioned people hear
   * about it on their Notifications page, if they may read the note.
   *
   * Under the box, a line says who can read the note, from my sharing
   * settings, with a link to change them on my profile (issue #173). Notes are
   * public by default, and a box with no word about it reads as private.
   */
  import { tick } from 'svelte';
  import { api, bookmarksApi, notesApi, profileHref, NOTE_MAX, type Note, type PublicUser, type SavedNote } from '$lib/api';
  import { mentionAt, mentionablePeople, rankPeople } from '$lib/mentions';
  import { session } from '$lib/session.svelte';
  import { SEES } from '$lib/visibility';
  import { showToast } from '$lib/toast.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Textarea from '$lib/components/Textarea.svelte';

  let { itemId = null, bookmarkId = null, note = null, onsaved, ondeleted, oncancel }: {
    itemId?: number | null; bookmarkId?: number | null; note?: Note | null;
    onsaved: (n: SavedNote) => void; ondeleted: () => void; oncancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let body = $state(note?.body ?? '');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let box = $state<HTMLTextAreaElement | null>(null);
  const dirty = $derived(body.trim() !== (note?.body ?? ''));
  const over = $derived(body.length > NOTE_MAX);

  $effect(() => { box?.focus(); });

  // ---- who can read it: a private profile hides my notes from everyone, whatever the notes setting says
  const me = $derived(session.user);
  const audience = $derived(me ? `${SEES[me.profileVisibility === 'public' ? me.notesVisibility : 'private']} your notes` : null);

  // ---- @mention suggestions
  const uid = $props.id();
  const listId = `${uid}-people`;
  let people = $state<PublicUser[]>([]);
  let asked = false;
  /** The mention being typed: where its `@` is, and the letters after it. */
  let typing = $state<{ start: number; query: string } | null>(null);
  /** An `@` whose suggestions were closed with Escape stays closed until another one. */
  let dismissed = $state<number | null>(null);
  let active = $state(0);
  const options = $derived(typing ? rankPeople(people, typing.query) : []);
  const open = $derived(options.length > 0);

  // The list sits in the top layer (a popover), placed under the box by hand,
  // so a card that clips its contents (Card.svelte, overflow: hidden) can't cut
  // it off. It goes above the box when there is no room below.
  let combo = $state<HTMLDivElement | null>(null);
  let list = $state<HTMLUListElement | null>(null);
  function place() {
    if (!combo || !list) return;
    const r = combo.getBoundingClientRect();
    const h = list.offsetHeight;
    const gap = 4;
    const above = r.bottom + gap + h > window.innerHeight && r.top - gap - h > 0;
    list.style.left = `${r.left}px`;
    list.style.width = `${r.width}px`;
    list.style.top = `${above ? r.top - gap - h : r.bottom + gap}px`;
  }
  $effect(() => {
    if (!list) return;
    if (!open) { if (list.matches(':popover-open')) list.hidePopover(); return; }
    void options.length;
    if (!list.matches(':popover-open')) list.showPopover();
    place();
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => { removeEventListener('scroll', place, true); removeEventListener('resize', place); };
  });

  /** Look at what is just before the caret: is a mention being typed there? */
  function track() {
    if (!box || box.selectionStart !== box.selectionEnd) { typing = null; return; }
    const at = mentionAt(box.value, box.selectionStart);
    if (at && !asked && session.user) {
      asked = true;
      void mentionablePeople(session.user.handle).then((list) => (people = list));
    }
    const next = at && at.start !== dismissed ? at : null;
    if (next?.start !== typing?.start || next?.query !== typing?.query) active = 0;
    if (!at) dismissed = null;
    typing = next;
  }

  /** Put `@handle ` in place of what was typed, and the caret after it. */
  async function pick(p: PublicUser) {
    if (!box || !typing) return;
    const caret = box.selectionStart;
    const rest = body.slice(caret);
    const space = /^\s/.test(rest) ? '' : ' ';
    body = `${body.slice(0, typing.start)}@${p.handle}${space}${rest}`;
    const pos = typing.start + p.handle.length + 2;
    typing = null;
    api.event('mention_picked', { via: 'typeahead' });
    await tick();
    box.focus();
    box.setSelectionRange(pos, pos);
  }

  /** Cmd/Ctrl+Enter saves without reaching for the button; Escape backs out. With suggestions open, the keys work the list first. */
  function keys(e: KeyboardEvent) {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        return;
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
        e.preventDefault();
        void pick(options[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismissed = typing?.start ?? null;
        typing = null;
        return;
      }
    }
    if (e.key === 'Escape') oncancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  }

  async function save() {
    if (busy || !body.trim() || over) return;
    busy = true; error = null;
    try {
      const saved = itemId !== null ? await notesApi.write(itemId, body) : await bookmarksApi.writeNote(bookmarkId!, body);
      api.event(note ? 'note_edited' : 'note_written', { itemId, bookmarkId: saved.bookmarkId, length: saved.body.length, mentions: saved.mentions?.length ?? 0 });
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
      if (itemId !== null) await notesApi.remove(itemId);
      else await bookmarksApi.removeNote(bookmarkId!);
      api.event('note_deleted', { itemId, bookmarkId });
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
      <div class="combo" bind:this={combo}>
        <Textarea
          {id}
          aria-describedby={[describedBy, audience && `${uid}-audience`].filter(Boolean).join(' ') || undefined}
          {invalid}
          bind:element={box}
          bind:value={body}
          rows={4}
          maxlength={NOTE_MAX + 200}
          limit={NOTE_MAX}
          counter
          disabled={busy}
          placeholder="Add a note. Markdown works: **bold**, *italic*, [links](https://…), - lists. Type @ to mention someone."
          role="combobox"
          aria-multiline="true"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onkeydown={keys}
          oninput={track}
          onkeyup={(e: KeyboardEvent) => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) track(); }}
          onclick={track}
          onblur={() => (typing = null)}
        />
        <!-- Pressing a suggestion must not take focus from the box, or the caret (and the mention being typed) would be lost. -->
        <ul class="people" id={listId} role="listbox" aria-label="People to mention" popover="manual" bind:this={list}>
          {#each options as p, i (p.handle)}
            <!-- The keyboard works the list from the box (aria-activedescendant), so an option itself only needs the pointer. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li id="{listId}-{i}" role="option" aria-selected={i === active} class:active={i === active}
              onmousedown={(e) => e.preventDefault()} onclick={() => pick(p)} onmouseenter={() => (active = i)}>
              <Avatar handle={p.handle} name={p.displayName ?? p.handle} size={24} v={p.avatarUpdatedAt} />
              <span class="names">{#if p.displayName}<span class="dn">{p.displayName}</span>{/if}<span class="h">@{p.handle}</span></span>
            </li>
          {/each}
        </ul>
      </div>
    {/snippet}
  </Field>
  {#if me && audience}<p class="audience" id="{uid}-audience">{audience} <Dot /> <a href={profileHref(me.handle) + (me.profileVisibility === 'public' ? '#bookmarks' : '')}>Change</a></p>{/if}
  <div class="row">
    <Button type="submit" variant="primary" disabled={busy || !dirty || !body.trim() || over}>{busy ? 'Saving…' : 'Save'}</Button>
    <Button onclick={oncancel} disabled={busy}>Cancel</Button>
    {#if note}<Button variant="danger" onclick={remove} disabled={busy} style="margin-left: auto">Delete</Button>{/if}
  </div>
</form>

<style>
  .editor { border-top: 1px solid var(--line); padding: var(--space-3) var(--space-4); }
  /* Read like the field's own note: same size and gray. */
  .audience { margin: var(--space-1) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  .audience a { color: var(--accent); font-weight: 600; }
  .row { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }
  /* The suggestions hang just under the box, over whatever follows, as wide as the box: placed by place(), in the top layer. */
  .people {
    position: fixed; inset: auto; border: 0;
    list-style: none; margin: 0; padding: var(--space-1); max-height: 280px; overflow-y: auto;
    background: var(--surface); color: var(--text); border-radius: var(--radius-md); box-shadow: var(--shadow-menu);
  }
  .people li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); cursor: pointer; min-height: 44px; }
  /* The highlighted one: a fill and a bar, so it reads without color. */
  .people li.active { background: var(--surface-2); box-shadow: inset 3px 0 0 var(--accent); }
  .names { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
  .dn { font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
