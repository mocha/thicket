<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { authApi } from '$lib/api';
  import { session, loadMe } from '$lib/session.svelte';

  /**
   * Where the emailed confirmation link lands. Works signed out, since people
   * often open the email on another device. Confirming happens on arrival;
   * there's nothing to press.
   */
  let phase = $state<'working' | 'done' | 'dead' | 'failed'>('working');
  let failure = $state('');

  onMount(async () => {
    const token = page.url.searchParams.get('token') ?? '';
    try {
      await authApi.confirmEmail(token);
      phase = 'done';
      if (session.user) void loadMe();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 410 || !token) phase = 'dead';
      else { phase = 'failed'; failure = e instanceof Error ? e.message : String(e); }
    }
  });
</script>

<svelte:head><title>Confirm your email · thicket</title></svelte:head>

<section class="auth" aria-live="polite">
  {#if phase === 'working'}
    <p class="lede">Confirming your email…</p>
  {:else if phase === 'done'}
    <h1>Email confirmed</h1>
    <p class="lede">If you forget your password, you can reset it from the login page.</p>
    <p class="alt">{#if session.user}<a href="/new-posts">Read new posts</a>{:else}<a href="/login">Log in</a>{/if}</p>
  {:else if phase === 'dead'}
    <h1>That link doesn’t work anymore</h1>
    <p class="lede">Links expire after 24 hours and work only once. You can send a new one from your <a href="/account">Account page</a>.</p>
  {:else}
    <h1>We couldn’t confirm your email</h1>
    <p class="lede">{failure} Try the link again in a few minutes.</p>
  {/if}
</section>

<style>
  .auth { max-width: 380px; margin: calc(var(--space-6) + var(--space-2)) auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-3); }
  .lede { margin: 0; color: var(--text-2); line-height: 1.45; }
  .lede a, .alt a { color: var(--accent); font-weight: 600; }
  .alt { margin: var(--space-5) 0 0; }
</style>
