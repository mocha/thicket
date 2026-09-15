<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authApi } from '$lib/api';
  import { setMe } from '$lib/session.svelte';

  let handle = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit() {
    if (busy) return;
    busy = true; error = null;
    try {
      setMe(await authApi.login(handle, password));
      await goto(page.url.searchParams.get('next') || '/', { replaceState: true });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Log in · thicket</title></svelte:head>

<section class="auth">
  <h1>Welcome back</h1>
  <form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <label><span>Handle</span><input type="text" bind:value={handle} autocomplete="username" autocapitalize="off" spellcheck="false" required placeholder="you" /></label>
    <label><span>Password</span><input type="password" bind:value={password} autocomplete="current-password" required /></label>
    {#if error}<p class="bad" role="alert">{error}</p>{/if}
    <button type="submit" disabled={busy || !handle.trim() || !password}>{busy ? 'Logging in…' : 'Log in'}</button>
  </form>
  <p class="alt">New here? <a href="/signup{page.url.search}">Create an account</a></p>
  <p class="hint">Forgot your password? There’s no email on this instance: ask whoever runs it to reset it.</p>
</section>

<style>
  .auth { max-width: 380px; margin: 40px auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(30px * var(--size-headings)); margin: 0 0 20px; }
  form { display: flex; flex-direction: column; gap: 14px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: calc(13px * var(--size-app)); font-weight: 600; color: var(--text-2); }
  input { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: calc(16px * var(--size-app)); }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { margin-top: 4px; padding: 13px; border-radius: 12px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(16px * var(--size-app)); }
  button:disabled { opacity: 0.5; }
  .bad { color: var(--danger); margin: 0; font-size: calc(14px * var(--size-app)); }
  .alt { margin: 22px 0 0; color: var(--text-2); }
  .alt a { color: var(--accent); font-weight: 600; }
  .hint { margin: 8px 0 0; font-size: calc(13px * var(--size-app)); color: var(--text-3); }
</style>
