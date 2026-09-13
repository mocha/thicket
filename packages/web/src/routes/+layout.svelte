<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Nav from '$lib/components/Nav.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import AddFeedSheet from '$lib/components/AddFeedSheet.svelte';
  import { addFeed } from '$lib/addfeed.svelte';
  import { session, loadMe, isPublicPath } from '$lib/session.svelte';
  import { loadAppearance } from '$lib/theme.svelte';
  let { children } = $props();

  /**
   * The auth gate. We learn who is signed in before rendering any page, so no
   * page ever fires a request as the wrong person or flashes an empty state.
   * Public paths (/@handle…, /login, /signup) render for anyone; everything
   * else bounces to /login and comes back afterwards.
   */
  onMount(() => { loadAppearance(); void loadMe(); });

  const path = $derived(page.url.pathname);
  const isPublic = $derived(isPublicPath(path));
  const signedIn = $derived(!!session.user);

  $effect(() => {
    if (!session.loaded) return;
    if (!signedIn && !isPublic) void goto(`/login?next=${encodeURIComponent(path + page.url.search)}`, { replaceState: true });
    else if (signedIn && (path === '/login' || path === '/signup')) void goto(page.url.searchParams.get('next') || '/', { replaceState: true });
  });
  const show = $derived(session.loaded && (signedIn || isPublic));
</script>

<svelte:head><title>thicket</title></svelte:head>

{#if signedIn}
  <Nav />
{:else if session.loaded}
  <header class="anon" class:home={path === '/'}>
    <a class="brand" href="/"><img src="/icon.svg" alt="" width="24" height="24" /><span>thicket</span></a>
    {#if path !== '/login' && path !== '/signup' && path !== '/'}
      <span class="auth"><a href="/login?next={encodeURIComponent(path)}">Log in</a><a class="primary" href="/signup?next={encodeURIComponent(path)}">Sign up</a></span>
    {/if}
  </header>
{/if}

<main class:anon={!signedIn} class:home={!signedIn && path === '/'}>
  {#if show}{@render children()}
  {:else if session.unreachable}
    <div class="unreachable" role="status">
      <h1>Can’t reach thicket</h1>
      <p>The server isn’t answering ({session.unreachable}). Retrying…</p>
    </div>
  {/if}
</main>
{#if signedIn && addFeed.open}<AddFeedSheet />{/if}
<Toast />

<style>
  main {
    max-width: 640px; margin: 0 auto;
    padding: 12px 12px calc(var(--nav-h) + var(--safe-b) + 24px);
  }
  main.anon { padding-bottom: 40px; }
  .unreachable { text-align: center; padding: 80px 20px; color: var(--text-2); }
  .unreachable h1 { font-family: var(--font-serif); font-size: 24px; margin: 0 0 8px; color: var(--text); }
  .unreachable p { margin: 0; }
  header.anon {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    max-width: 640px; margin: 0 auto; padding: 14px 12px 4px;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 18px; letter-spacing: -0.01em; }
  .auth { display: flex; gap: 8px; align-items: center; }
  .auth a { font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); color: var(--text-2); }
  .auth a.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  @media (min-width: 900px) {
    main:not(.anon) { margin-left: calc(240px + max(24px, (100vw - 240px - 640px) / 2)); padding: 28px 24px 60px; }
    main.anon, header.anon { max-width: 680px; }
    main.home, header.anon.home { max-width: 1040px; }
    main.anon { padding: 20px 24px 60px; }
    header.anon { padding: 20px 24px 0; }
  }
</style>
