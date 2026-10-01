<script lang="ts">
  import { authApi } from '$lib/api';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';

  /**
   * "Forgot your password?", readthicket.com only (the login page links here
   * only there). Takes a handle or an email. The answer is the same whether or
   * not an account matched, so this page can't be used to learn who has one.
   */
  let who = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let error = $state<string | null>(null);

  async function submit() {
    if (busy) return;
    busy = true; error = null;
    try {
      await authApi.forgotPassword(who.trim());
      sent = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Reset your password · thicket</title></svelte:head>

<section class="auth">
  {#if sent}
    <h1>Check your email</h1>
    <p class="lede">If your account has a confirmed email, a reset link is on its way. It expires in 1 hour.</p>
    <p class="lede">No email on your account? We can’t confirm it’s yours, so we can’t reset your password.</p>
  {:else}
    <h1>Reset your password</h1>
    <p class="lede">Enter your handle or the email on your account, and we’ll send you a link to choose a new password.</p>
    <form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Field label="Handle or email">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} bind:value={who} autocomplete="username" autocapitalize="off" spellcheck="false" required />
        {/snippet}
      </Field>
      {#if error}<p class="bad" role="alert">{error}</p>{/if}
      <Button type="submit" variant="primary" solid size="lg" disabled={busy || !who.trim()} loading={busy}>Send reset link</Button>
    </form>
  {/if}
  <p class="alt"><a class="tap" href="/login">Back to log in</a></p>
</section>

<style>
  .auth { max-width: 380px; margin: calc(var(--space-6) + var(--space-2)) auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-3); }
  .lede { margin: 0 0 var(--space-5); color: var(--text-2); line-height: 1.45; }
  form { display: flex; flex-direction: column; gap: var(--space-5); }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .alt { margin: var(--space-5) 0 0; color: var(--text-2); }
  .alt a { color: var(--accent); font-weight: 600; }
</style>
