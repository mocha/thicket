<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authApi, ApiError } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * Where an emailed reset link lands. Choosing a new password signs out every
   * other device and signs you in here. A link that's expired or used (the
   * server answers 410) swaps the form for a way to get a new one.
   */
  const token = $derived(page.url.searchParams.get('token') ?? '');
  let password = $state('');
  let busy = $state(false);
  let error = $state<{ message: string; field?: string } | null>(null);
  let dead = $state(false);

  async function submit() {
    if (busy) return;
    busy = true; error = null;
    try {
      setMe(await authApi.resetPassword(token, password));
      showToast('Password changed. Other devices were signed out.');
      await goto('/new-posts', { replaceState: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) dead = true;
      else error = e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Choose a new password · thicket</title></svelte:head>

<section class="auth">
  {#if dead || !token}
    <h1>That link doesn’t work anymore</h1>
    <p class="lede">Reset links expire after 1 hour and work only once.</p>
    <p class="alt"><a href="/forgot-password">Send a new link</a></p>
  {:else}
    <h1>Choose a new password</h1>
    <form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Field label="New password" hint="At least 8 characters." error={error?.field === 'password' ? error.message : null}>
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} type="password" bind:value={password} autocomplete="new-password" required minlength={8} />
        {/snippet}
      </Field>
      {#if error && !error.field}<p class="bad" role="alert">{error.message}</p>{/if}
      <Button type="submit" variant="primary" solid size="lg" disabled={busy || password.length < 8} loading={busy}>Save password</Button>
    </form>
  {/if}
</section>

<style>
  .auth { max-width: 380px; margin: calc(var(--space-6) + var(--space-2)) auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-5); }
  .lede { margin: calc(-1 * var(--space-2)) 0 0; color: var(--text-2); line-height: 1.45; }
  form { display: flex; flex-direction: column; gap: var(--space-5); }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .alt { margin: var(--space-5) 0 0; color: var(--text-2); }
  .alt a { color: var(--accent); font-weight: 600; }
</style>
