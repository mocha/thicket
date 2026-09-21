<script lang="ts">
  /**
   * Read a post here, over the list. Full screen on a phone, a tall sheet on a
   * desk; the list dims behind it and a tap on the dim closes it, as does the
   * back button. What shows is what the feed sent, made safe on the server;
   * when that is only a teaser the reader says so and the way out to the
   * original is right there. The original is always one press away regardless.
   */
  import { page } from '$app/state';
  import { api, itemsApi, type ItemContent, type Note } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import { closeReader, reader, readerClosed } from '$lib/reader.svelte';
  import { showToast } from '$lib/toast.svelte';
  import SourceIcon from './SourceIcon.svelte';
  import IconButton from './IconButton.svelte';
  import ItemActions from './ItemActions.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import NoteBlock from './NoteBlock.svelte';
  import Pager from './Pager.svelte';
  import { display } from '$lib/display.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let sheet = $state<HTMLElement | null>(null);
  let head = $state<HTMLElement | null>(null);

  /* ---- Paged reading: the article is laid out in columns one screen wide and shown one column at a time. ---- */
  const paged = $derived(display.layout === 'paged');
  let pageW = $state(0);
  let pageH = $state(0);
  let headH = $state(0);
  let pageIndex = $state(0);
  let pageCount = $state(1);
  /** Columns per page: one on a phone, a book-like two on a wide screen. Gap 24px = the sheet's side padding, so the stride is exactly the frame width. */
  const cols = $derived(Math.max(1, Math.round(pageW / 620)));
  function measurePages() {
    if (!paged || !scroller || !sheet) return;
    headH = head?.offsetHeight ?? 0;
    pageW = scroller.clientWidth;
    pageH = scroller.clientHeight;
    // Let the columns lay out at the new size, then count them.
    requestAnimationFrame(() => { if (sheet && pageW) { pageCount = Math.max(1, Math.ceil((sheet.scrollWidth - 8) / pageW)); if (pageIndex >= pageCount) pageIndex = pageCount - 1; } });
  }
  $effect(() => {
    if (!paged || !item || !scroller) return;
    measurePages();
    const ro = new ResizeObserver(measurePages);
    ro.observe(scroller);
    if (sheet) ro.observe(sheet);
    // Pictures arriving later push text into new columns; count again as each one lands.
    const onload = () => measurePages();
    sheet?.addEventListener('load', onload, true);
    const late = setTimeout(measurePages, 1200);
    return () => { ro.disconnect(); sheet?.removeEventListener('load', onload, true); clearTimeout(late); };
  });
  $effect(() => { void content; void editing; if (paged) requestAnimationFrame(measurePages); });
  function nextPage() { if (pageIndex < pageCount - 1) pageIndex++; }
  function prevPage() { if (pageIndex > 0) pageIndex--; }
  let content = $state<ItemContent | null>(null);
  let error = $state<string | null>(null);
  let editing = $state(false);

  const item = $derived(reader.item);
  const source = $derived(item ? item.feedTitle ?? hostOf(item.siteUrl ?? item.url) : '');
  const href = $derived(item?.url ?? item?.siteUrl ?? '#');
  const others = $derived(item?.notes ?? []);
  /** A video post is watched, not read. */
  const isVideo = $derived(/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(hostOf(href)));
  /** The card's picture leads the article unless the body brings its own. */
  const showHero = $derived(!!item?.imageUrl && content !== null && !content.hasImages);

  // History is the source of truth for "open": the store sets it, the state entry keeps it.
  const openFor = $derived(page.state.reader);
  $effect(() => {
    if (item && openFor === item.id) {
      // Paged: not modal, so the bottom bar stays live while reading and the reader sits above it.
      if (!dialog?.open) { if (paged) dialog?.show(); else dialog?.showModal(); }
    } else if (item) {
      dialog?.close();
      readerClosed();
    }
  });

  /**
   * The open post names the tab, so bookmarking it in the browser, or picking
   * it out of a row of tabs, gets the post rather than "thicket". Set by hand
   * rather than with <svelte:head>: the layout has a title too, and the browser
   * reads the first <title> in the document, not the last one written.
   */
  $effect(() => {
    if (!item) return;
    const was = document.title;
    document.title = item.title ? `${item.title} · thicket` : was;
    return () => { document.title = was; };
  });

  $effect(() => {
    const it = item;
    content = null; error = null; editing = reader.note; pageIndex = 0;
    if (!it) return;
    scroller?.scrollTo({ top: 0 });
    api.event('item_opened', { itemId: it.id, feedId: it.feedId, inline: true });
    itemsApi.content(it.id).then((c) => { if (reader.item?.id === it.id) content = c; }, (e) => { if (reader.item?.id === it.id) error = e instanceof Error ? e.message : String(e); });
  });

  /**
   * Close = leave the post's address behind. The store decides where that is;
   * losing the history entry is what shuts the dialog, in the effect above.
   */
  function close() {
    closeReader();
  }
  /** Escape closes the dialog natively when modal; keep history in step. Non-modal (paged) gets no cancel event, so listen for the key. */
  function canceled(e: Event) { e.preventDefault(); close(); }
  function keys(e: KeyboardEvent) { if (paged && item && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } }

  function noteButton() {
    editing = !editing;
    if (editing) { api.event('note_editor_opened', { itemId: item!.id, existing: !!item!.myNote, via: 'reader' }); scroller?.scrollTo({ top: 0, behavior: 'smooth' }); }
  }
  function noteSaved(n: Note) { if (!item) return; showToast(item.myNote ? 'Note updated' : 'Note saved'); item.myNote = n; editing = false; }

  function outbound() { if (item) api.event('item_opened', { itemId: item.id, feedId: item.feedId, via: 'reader' }); }
</script>

<svelte:window onkeydown={keys} />

<dialog bind:this={dialog} class:paged onclose={() => closeReader()} oncancel={canceled} onclick={(e) => { if (e.target === dialog) close(); }} aria-label={item?.title ?? 'Post'}>
  {#if item}
    <article class="reader">
      <header bind:this={head}>
        <span class="source"><SourceIcon feedId={item.feedId} hasIcon={item.hasIcon} name={source} /><span class="name">{source}</span></span>
        <time datetime={item.publishedAt}>{relativeTime(item.publishedAt)}</time>
        <span class="spacer"></span>
        <ItemActions {item} noteOpen={editing} onnote={noteButton} via="reader" />
        <IconButton icon="close" label="Close" iconSize={20} onclick={close} />
      </header>

      <div class="scroll" class:paged bind:this={scroller}>
        <div class="page" bind:this={sheet} style:column-count={paged && pageW ? cols : undefined} style:height={paged && pageH ? `${pageH}px` : undefined} style:transform={paged ? `translateX(${-pageIndex * pageW}px)` : undefined}>
          {#if editing}
            <NoteEditor itemId={item.id} note={item.myNote} onsaved={noteSaved} ondeleted={() => { if (item) item.myNote = null; editing = false; }} oncancel={() => (editing = false)} />
          {/if}

          <h1>{item.title ?? item.summary ?? item.url}</h1>
          <p class="byline">
            {#if item.author}<span>{item.author}</span><span class="dot">·</span>{/if}
            <time datetime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>{new Date(item.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>
          </p>

          {#if showHero}<img class="hero" src={item.imageUrl} alt="" referrerpolicy="no-referrer" />{/if}

          {#if content}
            {#if content.html.trim()}
              <div class="body">{@html content.html}</div>
            {:else}
              <p class="nobody">This site didn’t send the post’s text, only its title.</p>
            {/if}
          {:else if error}
            <p class="nobody">Couldn’t load the post: {error}</p>
          {:else}
            {#if item.summary && item.summary !== item.title}<p class="teaser">{item.summary}</p>{/if}
            <p class="loading" aria-live="polite">Loading…</p>
          {/if}

          <footer>
            {#if content?.partial}
              <p class="partial">
                {#if content.typicalLength !== null && content.typicalLength < 1000}This site only sends a preview of its posts.{:else}This looks like a preview, not the whole post.{/if}
              </p>
            {/if}
            <a class="out" {href} target="_blank" rel="noopener" onclick={outbound}>{isVideo ? 'Watch on ' + hostOf(href).replace(/^www\./, '') : 'Read on original site'} <span aria-hidden="true">↗</span></a>
          </footer>

          {#if item.myNote && !editing}<NoteBlock note={item.myNote} mine onedit={() => (editing = true)} />{/if}
          {#each others as n (n.id)}<NoteBlock note={n} />{/each}
        </div>
      </div>
    </article>
    {#if paged}
      <div class="pagenum" aria-live="polite">{pageIndex + 1} / {pageCount}</div>
      <Pager canPrev={pageIndex > 0} canNext={pageIndex < pageCount - 1} onprev={prevPage} onnext={nextPage} label="page" top="{headH}px" bottom="calc(var(--nav-h) + var(--safe-b))" inDialog />
    {/if}
  {/if}
</dialog>

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
  .reader {
    position: fixed; inset: 0; display: flex; flex-direction: column;
    background: var(--surface); color: var(--text);
  }
  @media (min-width: 760px) {
    .reader { inset: 24px auto 24px 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 48px)); border-radius: var(--radius); box-shadow: var(--shadow); border: var(--card-border, 0); overflow: hidden; }
  }
  header {
    display: flex; align-items: center; gap: 8px; flex: none;
    padding: 10px 8px 8px 16px; border-bottom: 1px solid var(--line); font-size: calc(13px * var(--size-app)); color: var(--text-2); min-width: 0;
  }
  .source { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .name { font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  header time { color: var(--text-3); white-space: nowrap; }
  .spacer { flex: 1; }

  .scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .page { max-width: 680px; margin: 0 auto; padding: 20px 16px calc(24px + var(--safe-b)); }
  h1 { margin: 0; font-family: var(--font-headings); font-weight: 600; font-size: calc(27px * var(--size-headings)); line-height: 1.2; letter-spacing: -0.012em; overflow-wrap: anywhere; text-wrap: balance; }
  .byline { margin: 10px 0 0; font-size: calc(14px * var(--size-app)); color: var(--text-3); display: flex; gap: 6px; flex-wrap: wrap; }
  .hero { width: 100%; border-radius: var(--radius-sm); margin-top: 18px; background: var(--surface-2); }
  .teaser { font-family: var(--font-reading); font-size: calc(17px * var(--size-reading)); color: var(--text-2); margin: 18px 0 0; }
  .loading, .nobody { margin: 20px 0 0; color: var(--text-3); font-size: calc(15px * var(--size-app)); }

  /* The article. Publisher HTML, sanitized to a known set of tags, set in the reading face. */
  .body { margin-top: 20px; font-family: var(--font-reading); font-size: calc(17px * var(--size-reading)); line-height: 1.6; color: var(--text); overflow-wrap: anywhere; }
  .body :global(p), .body :global(ul), .body :global(ol), .body :global(blockquote), .body :global(pre), .body :global(table), .body :global(figure), .body :global(details), .body :global(hr) { margin: 0 0 1em; }
  .body :global(h2), .body :global(h3), .body :global(h4), .body :global(h5), .body :global(h6) { font-family: var(--font-headings); line-height: 1.25; margin: 1.5em 0 0.5em; letter-spacing: -0.01em; }
  .body :global(h2) { font-size: 1.35em; } .body :global(h3) { font-size: 1.18em; } .body :global(h4), .body :global(h5), .body :global(h6) { font-size: 1em; }
  .body :global(a) { color: var(--accent); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); text-underline-offset: 3px; }
  .body :global(a:hover) { text-decoration-color: var(--accent); }
  .body :global(img), .body :global(video) { max-width: 100%; height: auto; border-radius: var(--radius-sm); margin: 0.4em auto; background: var(--surface-2); }
  .body :global(figure) { margin-left: 0; margin-right: 0; }
  .body :global(figcaption) { font-size: 0.85em; color: var(--text-3); text-align: center; margin-top: 0.3em; }
  .body :global(blockquote) { border-left: 3px solid var(--line); padding-left: 1em; color: var(--text-2); }
  .body :global(pre) { overflow-x: auto; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 0.85em; line-height: 1.5; }
  .body :global(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
  .body :global(:not(pre) > code) { background: var(--surface-2); padding: 0.1em 0.35em; border-radius: 5px; }
  .body :global(table) { display: block; overflow-x: auto; border-collapse: collapse; font-size: 0.9em; }
  .body :global(th), .body :global(td) { border: 1px solid var(--line); padding: 6px 9px; text-align: left; vertical-align: top; }
  .body :global(hr) { border: 0; border-top: 1px solid var(--line); }
  .body :global(sup) { font-size: 0.75em; }
  .body :global(mark) { background: color-mix(in srgb, var(--accent) 22%, transparent); color: inherit; }
  /* An embedded player, replaced on the server by a link to it. */
  .body :global(a[data-embed]) { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 22px 16px; margin: 0 0 1em; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px dashed var(--line); font-weight: 600; text-decoration: none; }
  .body :global(a[data-embed])::before { content: '▶'; font-size: 0.85em; }

  footer { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  .partial { margin: 0; font-size: calc(14px * var(--size-app)); color: var(--text-2); }
  .out { display: inline-flex; align-items: center; gap: 6px; padding: 12px 20px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(15px * var(--size-app)); }
  .out:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  footer + :global(.note) { margin-top: 18px; }

  /* Paged: the sheet is as tall as the frame and flows into columns one frame wide; the transform picks the column. Nothing scrolls. */
  .scroll.paged { overflow: hidden; margin: 0 var(--pager-w); }
  .scroll.paged .page { column-gap: 24px; column-fill: auto; max-width: none; padding: 16px 12px; box-sizing: border-box; }
  .scroll.paged h1, .scroll.paged .byline, .scroll.paged .hero, .scroll.paged footer, .scroll.paged :global(.note) { break-inside: avoid; }
  .scroll.paged .body :global(img), .scroll.paged .hero { max-height: 55vh; width: auto; max-width: 100%; margin-left: auto; margin-right: auto; break-inside: avoid; }
  .scroll.paged .body :global(p), .scroll.paged .body :global(li) { orphans: 2; widows: 2; }
  .scroll.paged .body :global(figure), .scroll.paged .body :global(pre), .scroll.paged .body :global(blockquote), .scroll.paged .body :global(table) { break-inside: avoid; }
  .pagenum { position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%); font-size: calc(12px * var(--size-app)); color: var(--text-3); font-variant-numeric: tabular-nums; z-index: 31; pointer-events: none; }
  /* Paged: the reader is a fixed sheet above the bottom bar (which stays clickable, since the dialog is not modal), full width at every size. */
  dialog.paged { position: fixed; top: 0; left: 0; right: 0; bottom: calc(var(--nav-h) + var(--safe-b)); width: auto; height: auto; max-height: none; z-index: 35; background: var(--surface); }
  dialog.paged .reader { position: absolute; inset: 0; transform: none; width: auto; border-radius: 0; box-shadow: none; border: 0; }
  dialog.paged .pagenum { bottom: 4px; }
</style>
