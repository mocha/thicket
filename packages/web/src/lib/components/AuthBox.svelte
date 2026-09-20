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

  onMount(() => {
    authApi.status().then((s) => { status = s; if (s.signups === 'closed') mode = 'login'; }).catch(() => (status = { name: 'thicket', url: '', signups: 'open', visitorLimit: true, billing: false }));
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
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={mode === 'signup'} class:on={mode === 'signup'} onclick={() => { mode = 'signup'; error = null; }} disabled={closed}>Create account</button>
    <button role="tab" aria-selected={mode === 'login'} class:on={mode === 'login'} onclick={() => { mode = 'login'; error = null; }}>Log in</button>
  </div>

  {#if mode === 'signup' && closed}
    <p class="note">Sign-ups are closed on this instance. If you have an account, log in.</p>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
      {#if mode === 'signup' && needsInvite}
        <label class:err={error?.field === 'inviteCode'}>
          <span>Invite code</span>
          <input type="text" bind:value={inviteCode} autocapitalize="off" spellcheck="false" placeholder="From the person who invited you" required />
        </label>
      {/if}
      <label class:err={error?.field === 'handle'}>
        <span>Handle</span>
        <span class="at"><span aria-hidden="true">@</span><input type="text" bind:value={handle} autocomplete="username" autocapitalize="off" spellcheck="false" required placeholder="you" /></span>
        {#if mode === 'signup'}<small>Your page will be /@{handleClean || 'you'}</small>{/if}
      </label>
      <label class:err={error?.field === 'password'}>
        <span>Password</span>
        <input type="password" bind:value={password} autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} required minlength={mode === 'signup' ? 8 : undefined} />
        {#if mode === 'signup'}<small>At least 8 characters.</small>{/if}
      </label>
      {#if error}<p class="bad" role="alert">{error.message}</p>{/if}
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

<style>
  .box { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px; }
  .tabs { display: flex; gap: 4px; background: var(--surface-2); border-radius: 12px; padding: 4px; margin-bottom: 16px; }
  .tabs button { flex: 1; padding: 9px; border-radius: 9px; font-weight: 600; font-size: calc(14px * var(--size-app)); color: var(--text-2); }
  .tabs button.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
  .tabs button:disabled { opacity: 0.4; }
  form { display: flex; flex-direction: column; gap: 12px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: calc(13px * var(--size-app)); font-weight: 600; color: var(--text-2); }
  small { font-weight: 400; color: var(--text-3); }
  input { padding: 11px 13px; border-radius: 11px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: calc(16px * var(--size-app)); width: 100%; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .at { display: flex; align-items: center; border-radius: 11px; border: 1px solid var(--line); background: var(--bg); padding-left: 12px; color: var(--text-3); font-size: calc(16px * var(--size-app)); }
  .at input { border: 0; padding-left: 2px; background: transparent; }
  .at:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
  .at input:focus { outline: none; }
  .err input, .err .at { border-color: var(--danger); }
  .go { margin-top: 2px; padding: 13px; border-radius: 12px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(16px * var(--size-app)); }
  .go:disabled { opacity: 0.5; }
  .bad { color: var(--danger); margin: 0; font-size: calc(14px * var(--size-app)); }
  .note { margin: 12px 0 0; font-size: calc(13px * var(--size-app)); color: var(--text-3); line-height: 1.4; }
  .note strong { color: var(--text-2); }
</style>
