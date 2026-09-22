<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Nav from '$lib/components/Nav.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import AddFeedSheet from '$lib/components/AddFeedSheet.svelte';
  import Reader from '$lib/components/Reader.svelte';
  import Configurator from '$lib/components/display/Configurator.svelte';
  import { addFeed } from '$lib/addfeed.svelte';
  import Button from '$lib/components/Button.svelte';
  import { session, loadMe, isPublicPath } from '$lib/session.svelte';
  import { display, loadDisplay } from '$lib/display.svelte';
  import { watchMarks } from '$lib/marks.svelte';
  let { children } = $props();

  /**
   * The auth gate. We learn who is signed in before rendering any page, so no
   * page ever fires a request as the wrong person or flashes an empty state.
   * Public paths (/@handle…, /login, /signup) render for anyone; everything
   * else bounces to /login and comes back afterwards.
   */
  onMount(() => { loadDisplay(); void loadMe(); });

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

  $effect(() => {
    if (!session.loaded) return;
    if (!signedIn && !isPublic) void goto(`/login?next=${encodeURIComponent(path + page.url.search)}`, { replaceState: true });
    else if (signedIn && (path === '/login' || path === '/signup')) void goto(page.url.searchParams.get('next') || '/', { replaceState: true });
  });
  const show = $derived(session.loaded && (signedIn || isPublic));

  // "What's new" counts, only while this device has the option on and someone is signed in.
  $effect(() => { if (signedIn && display.fresh) return watchMarks(); });
</script>

<svelte:head><title>thicket</title></svelte:head>

{#if bare}
  <main class="bare">{@render children()}</main>
{:else}
  {#if signedIn}
    <Nav />
  {:else if session.loaded}
    <header class="anon" class:home={path === '/'}>
      <a class="brand" href="/"><img src="/icon.svg" alt="" width="24" height="24" /><span>thicket</span></a>
      {#if path !== '/login' && path !== '/signup' && path !== '/'}
        <span class="auth"><Button href="/login?next={encodeURIComponent(path)}">Log in</Button><Button variant="primary" href="/signup?next={encodeURIComponent(path)}">Sign up</Button></span>
      {/if}
    </header>
  {/if}

  <main class:anon={!signedIn} class:home={!signedIn && path === '/'} class:paged={display.layout === 'paged'}>
    {#if show}{@render children()}
    {:else if session.unreachable}
      <div class="unreachable" role="status">
        <h1>Can’t reach thicket</h1>
        <p>The server isn’t answering ({session.unreachable}). Retrying…</p>
      </div>
    {/if}
  </main>
  {#if signedIn && addFeed.open}<AddFeedSheet />{/if}
  {#if signedIn}<Reader /><Configurator />{/if}
{/if}
<Toast />

<style>
  main {
    max-width: 640px; margin: 0 auto;
    padding: calc(env(safe-area-inset-top, 0px) + var(--space-5)) var(--space-3) calc(var(--nav-h) + var(--safe-b) + var(--space-5));
  }
  main.anon { padding-bottom: calc(var(--space-6) + var(--space-2)); }
  /* The design system runs on its own, without the app's chrome. A wider column
     than the reading app uses, so a gallery of swatches and controls has room. */
  main.bare {
    max-width: 900px;
    padding: calc(env(safe-area-inset-top, 0px) + var(--space-5)) var(--space-4) calc(var(--space-6) + var(--space-5));
  }
  /* Paged: room for the page-turn strips down both sides. */
  main.paged { max-width: none; padding-left: calc(var(--pager-w) + var(--space-2)); padding-right: calc(var(--pager-w) + var(--space-2)); }
  /* 80px is how far down the offline notice sits, a layout drop rather than a spacing step. */
  .unreachable { text-align: center; padding: 80px var(--space-5); color: var(--text-2); }
  .unreachable h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-2); color: var(--text); }
  .unreachable p { margin: 0; }
  header.anon {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
    max-width: 640px; margin: 0 auto; padding: var(--space-4) var(--space-3) var(--space-1);
  }
  .brand { display: flex; align-items: center; gap: var(--space-2); font-weight: 700; font-size: calc(var(--text-xl) * var(--size-app)); letter-spacing: -0.01em; }
  .auth { display: flex; gap: var(--space-2); align-items: center; }
  @media (min-width: 900px) {
    /* The left margin is column math, not spacing: the sidebar plus half of what's left over. */
    main:not(.anon):not(.paged):not(.bare) { margin-left: calc(var(--nav-w) + max(24px, (100vw - var(--nav-w) - 640px) / 2)); padding: calc(var(--space-5) + var(--space-1)) var(--space-5) calc(var(--space-6) + var(--space-5)); }
    main.anon, header.anon { max-width: 680px; }
    main.home, header.anon.home { max-width: 1040px; }
    main.anon { padding: var(--space-5) var(--space-5) calc(var(--space-6) + var(--space-5)); }
    header.anon { padding: var(--space-5) var(--space-5) 0; }
  }
</style>
