<script lang="ts">
  import '../app.css';
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Nav from '$lib/components/Nav.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import AddFeedSheet from '$lib/components/AddFeedSheet.svelte';
  import Reader from '$lib/components/Reader.svelte';
  import Configurator from '$lib/components/display/Configurator.svelte';
  import { addFeed } from '$lib/addfeed.svelte';
  import FeedbackSheet from '$lib/components/FeedbackSheet.svelte';
  import { feedback } from '$lib/feedback.svelte';
  import Button from '$lib/components/Button.svelte';
  import { session, loadMe, isPublicPath } from '$lib/session.svelte';
  import { display, loadDisplay, watchDisplay } from '$lib/display.svelte';
  import { watchMarks } from '$lib/marks.svelte';
  import { watchNotifs, loadNotifs } from '$lib/notifications.svelte';
  import { watchBackForward } from '$lib/listmemory';
  import Wordmark from '$lib/components/Wordmark.svelte';
  let { children } = $props();
  watchBackForward();

  /**
   * The auth gate. We learn who is signed in before rendering any page, so no
   * page ever fires a request as the wrong person or flashes an empty state.
   * Public paths (/@handle…, /login, /signup) render for anyone; everything
   * else bounces to /login and comes back afterwards.
   */
  onMount(() => { loadDisplay(); void loadMe(); return watchDisplay(); });

  const path = $derived(page.url.pathname);
  const isPublic = $derived(isPublicPath(path));
  const signedIn = $derived(!!session.user);
  /**
   * The design system stands on its own, without the app's nav, reader, or
   * configurator around it. It shows the pieces the app is built from, so it
   * shouldn't be wearing the app itself. It needs no account and no data, so it
   * renders straight away rather than waiting on who's signed in.
   */
  const bare = $derived(path === '/design-system');
  /** The front page only sends people on (to Everything or the login screen), so it draws no frame of its own. */
  const front = $derived(path === '/');
  const inApp = $derived(signedIn && !front);

  $effect(() => {
    if (!session.loaded) return;
    if (!signedIn && !isPublic) void goto(`/login?next=${encodeURIComponent(path + page.url.search)}`, { replaceState: true });
    else if (signedIn && (path === '/login' || path === '/signup')) void goto(page.url.searchParams.get('next') || '/everything', { replaceState: true });
  });
  const show = $derived(session.loaded && (signedIn || isPublic));
  /**
   * Paged layout keeps the bottom bar live while a post is open, so the reader
   * can't shut the whole page out the way it does when scrolling. The list it
   * covers is switched off instead, so Tab and a screen reader never wander
   * into posts that can't be seen.
   */
  /**
   * "Skip to content": the first thing Tab lands on, hidden until then. It
   * jumps past the sidebar (or the bottom bar, which also comes first in Tab
   * order) straight to the page, so nobody tabs through every collection on
   * every page. It moves focus itself rather than changing the address.
   */
  let content = $state<HTMLElement | null>(null);
  function skip(e: MouseEvent) {
    e.preventDefault();
    content?.focus();
    content?.scrollIntoView({ block: 'start' });
  }

  const covered = $derived(inApp && display.layout === 'paged' && page.state.reader !== undefined);

  // "What’s new" counts, only while the option is on and someone is signed in.
  $effect(() => { if (signedIn && display.fresh) return watchMarks(); });
  // The Notifications bubble: whenever someone is signed in, recounted on each move between pages (at most once a minute).
  $effect(() => { if (signedIn) return watchNotifs(); });
  $effect(() => { void path; if (signedIn) untrack(() => void loadNotifs()); });
</script>

<svelte:head><title>thicket</title></svelte:head>

<!-- Not while a paged post covers the page: the page it skips to is switched off then. -->
{#if !covered}<span class="skip"><Button variant="primary" href="#content" onclick={skip}>Skip to content</Button></span>{/if}

{#if bare}
  <main class="bare" id="content" tabindex="-1" bind:this={content}>{@render children()}</main>
{:else}
  {#if inApp}
    <Nav />
  {:else if session.loaded && !front}
    <header class="anon">
      <!-- A full page load, so on readthicket.com the server can hand / to its own landing page (see SITE_URL). -->
      <a class="brand tap" href="/" data-sveltekit-reload><img src="/icon.svg" alt="" width="32" height="32" /><Wordmark height={27} /></a>
      {#if !signedIn && path !== '/login' && path !== '/signup'}
        <span class="auth"><Button href="/login?next={encodeURIComponent(path)}">Log in</Button><Button variant="primary" href="/signup?next={encodeURIComponent(path)}">Sign up</Button></span>
      {/if}
    </header>
  {/if}

  <main class:anon={!inApp} class:paged={inApp && display.layout === 'paged'} inert={covered} id="content" tabindex="-1" bind:this={content}>
    {#if show}{@render children()}
    {:else if session.unreachable}
      <div class="unreachable" role="status">
        <h1>Can’t reach thicket</h1>
        <p>The server isn’t answering ({session.unreachable}). Retrying…</p>
      </div>
    {/if}
  </main>
  {#if inApp && addFeed.open}<AddFeedSheet />{/if}
  {#if inApp && feedback.open}<FeedbackSheet />{/if}
  {#if inApp}<Reader /><Configurator />{/if}
{/if}
<Toast sidebar={inApp && !bare && display.layout !== 'paged'} />

<style>
  /* Off the top of the screen until Tab reaches it, then in the top corner above everything. */
  .skip { position: fixed; top: var(--space-2); left: var(--space-2); z-index: 100; transform: translateY(-300%); }
  .skip:focus-within { transform: none; }
  /* Focus lands on the page itself after a skip; a ring around the whole page would say nothing. */
  main:focus { outline: none; }
  main {
    max-width: 640px; margin: 0 auto;
    padding: calc(env(safe-area-inset-top, 0px) + var(--space-5)) max(var(--space-3), env(safe-area-inset-right, 0px)) calc(var(--nav-h) + var(--safe-b) + var(--space-5)) max(var(--space-3), env(safe-area-inset-left, 0px));
  }
  main.anon { padding-bottom: calc(var(--space-6) + var(--space-2)); }
  /* The design system runs on its own, without the app's chrome. A wider column
     than the reading app uses, so a gallery of swatches and controls has room. */
  main.bare {
    max-width: 900px;
    padding: calc(env(safe-area-inset-top, 0px) + var(--space-5)) var(--space-4) calc(var(--space-6) + var(--space-5));
  }
  /* Paged: room for the page-turn strips down both sides. */
  main.paged { max-width: none; padding-left: calc(env(safe-area-inset-left, 0px) + var(--pager-w) + var(--space-2)); padding-right: calc(env(safe-area-inset-right, 0px) + var(--pager-w) + var(--space-2)); }
  /* 80px is how far down the offline notice sits, a layout drop rather than a spacing step. */
  .unreachable { text-align: center; padding: 80px var(--space-5); color: var(--text-2); }
  .unreachable h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-2); color: var(--text); }
  .unreachable p { margin: 0; }
  header.anon {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
    max-width: 640px; margin: 0 auto; padding: var(--space-4) var(--space-3);
    /* A hairline under the logo, running the full width of the window. Drawn as a
       border image pushed out past both sides: it paints edge to edge but, unlike a
       wider box, can't make the page scroll sideways. */
    border-bottom: 1px solid; border-image: linear-gradient(var(--line), var(--line)) 0 0 1 0 / 0 0 1px 0 / 0 100vw;
  }
  /* The logo and the wordmark, the word's tall letters nearly as tall as the logo. */
  .brand { display: flex; align-items: center; gap: calc(var(--space-2) + 2px); color: var(--text); }
  .auth { display: flex; gap: var(--space-2); align-items: center; }
  /* Where the sidebar shows; the same condition as in Nav.svelte. */
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) {
    /* The left margin is column math, not spacing: the sidebar plus half of what's left over. */
    main:not(.anon):not(.paged):not(.bare) { margin-left: calc(var(--nav-w) + max(24px, (100vw - var(--nav-w) - 640px) / 2)); padding: calc(var(--space-5) + var(--space-1)) var(--space-5) calc(var(--space-6) + var(--space-5)); }
  }
  @media (min-width: 900px) {
    main.anon, header.anon { max-width: 680px; }
    main.anon { padding: var(--space-5) var(--space-5) calc(var(--space-6) + var(--space-5)); }
    header.anon { padding: var(--space-5) var(--space-5) var(--space-4); }
  }
</style>
