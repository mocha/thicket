<script lang="ts">
  /**
   * Sign up or log in, in one small box. Sits in the homepage hero; the
   * dedicated /login and /signup pages still exist for links and invites.
   * Sign-up follows the instance policy: open shows the form, invite-only
   * asks for the code, closed offers only log in.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, authApi, ApiError, type InstanceStatus } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import Tabs from './Tabs.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';

  let { initial = 'signup' }: { initial?: 'signup' | 'login' } = $props();
  // svelte-ignore state_referenced_locally
  let mode = $state<'signup' | 'login'>(initial);
  let status = $state<InstanceStatus | null>(null);
  let handle = $state('');
  let password = $state('');
  let inviteCode = $state('');
  let busy = $state(false);
  let error = $state<{ message: string; field?: string } | null>(null);

  const handleClean = $derived(handle.trim().toLowerCase().replace(/^@/, ''));
  const handleOk = $derived(/^[a-z0-9][a-z0-9_-]{1,29}$/.test(handleClean));
  const needsInvite = $derived(status?.signups === 'invite');
  const closed = $derived(status?.signups === 'closed');
  const canSignup = $derived(handleOk && password.length >= 8 && (!needsInvite || inviteCode.trim().length > 0));
  const TABS = $derived([
    { value: 'signup', label: 'Create account', disabled: closed },
    { value: 'login', label: 'Log in' }
  ]);

  onMount(() => {
    authApi.status().then((s) => { status = s; if (s.signups === 'closed') mode = 'login'; }).catch(() => (status = { name: 'thicket', url: '', signups: 'open', visitorLimit: true }));
  });

  async function submit() {
    if (busy) return;
    busy = true; error = null;
    try {
      if (mode === 'signup') {
        setMe(await authApi.signup(handleClean, password, undefined, inviteCode.trim() || undefined));
        api.event('signed_up', { via: 'home' });
      } else {
        setMe(await authApi.login(handleClean, password));
      }
      await goto('/', { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }
</script>

<div class="box">
  <Tabs
    class="tabs"
    tabs={TABS}
    value={mode}
    onchange={(v) => { mode = v as 'signup' | 'login'; error = null; }}
    label="Create an account or log in"
    panel="auth-panel"
    fill
  />

  <div id="auth-panel" role="tabpanel">
    {#if mode === 'signup' && closed}
      <p class="note">Sign-ups are closed on this instance. If you have an account, log in.</p>
    {:else}
      <form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
        {#if mode === 'signup' && needsInvite}
          <Field label="Invite code" error={error?.field === 'inviteCode' ? error.message : null}>
            {#snippet children({ id, describedBy, invalid })}
              <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={inviteCode} autocapitalize="off" spellcheck="false" placeholder="From the person who invited you" required />
            {/snippet}
          </Field>
        {/if}
        <Field
          label="Handle"
          hint={mode === 'signup' ? `Your page will be /@${handleClean || 'you'}` : undefined}
          error={error?.field === 'handle' ? error.message : null}
        >
          {#snippet children({ id, describedBy, invalid })}
            <Input
              {id}
              aria-describedby={describedBy}
              {invalid}
              inset
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
        <Field
          label="Password"
          hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
          error={error?.field === 'password' ? error.message : null}
        >
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} inset type="password" bind:value={password} autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} required minlength={mode === 'signup' ? 8 : undefined} />
          {/snippet}
        </Field>
        {#if error && !error.field}<p class="bad" role="alert">{error.message}</p>{/if}
        <button type="submit" class="go" disabled={busy || (mode === 'signup' ? !canSignup : !handleClean || !password)}>
          {busy ? (mode === 'signup' ? 'Creating…' : 'Logging in…') : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </form>
      {#if mode === 'signup'}
        <p class="note">{#if needsInvite}This instance is invite-only.{:else}A handle and a password. Everything else is optional.{/if}{#if status?.name}{' '}You’re joining <strong>{status.name}</strong>.{/if}</p>
      {:else}
        <p class="note">Forgot your password? There’s no email here: ask whoever runs this instance to reset it.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .box { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px; }
  .box :global(.tabs) { margin-bottom: 16px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  .go { margin-top: 2px; padding: 13px; border-radius: 12px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  .go:disabled { opacity: 0.5; }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .note { margin: 12px 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); line-height: 1.4; }
  .note strong { color: var(--text-2); }
</style>
