<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authApi } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';

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
    <Field label="Handle">
      {#snippet children({ id, describedBy, invalid })}
        <Input
          {id}
          aria-describedby={describedBy}
          {invalid}
          bind:value={handle}
          autocomplete="username"
          autocapitalize="off"
          spellcheck="false"
          required
          placeholder="you"
          style="--field-gap: var(--space-1)"
        >
          {#snippet leading()}<span aria-hidden="true">@</span>{/snippet}
        </Input>
      {/snippet}
    </Field>
    <Field label="Password">
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} type="password" bind:value={password} autocomplete="current-password" required />
      {/snippet}
    </Field>
    {#if error}<p class="bad" role="alert">{error}</p>{/if}
    <button type="submit" disabled={busy || !handle.trim() || !password}>{busy ? 'Logging in…' : 'Log in'}</button>
  </form>
  <p class="alt">New here? <a href="/signup{page.url.search}">Create an account</a></p>
  <p class="hint">Forgot your password? There’s no email on this instance: ask whoever runs it to reset it.</p>
</section>

<style>
  .auth { max-width: 380px; margin: calc(var(--space-6) + var(--space-2)) auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-5); }
  form { display: flex; flex-direction: column; gap: var(--space-4); }
  button { margin-top: var(--space-1); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  button:disabled { opacity: 0.5; }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .alt { margin: var(--space-5) 0 0; color: var(--text-2); }
  .alt a { color: var(--accent); font-weight: 600; }
  .hint { margin: var(--space-2) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
</style>
