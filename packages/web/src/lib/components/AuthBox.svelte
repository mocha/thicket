<script lang="ts">
  /**
   * Sign up or log in, in one small box. Sits in the homepage hero, which is
   * thicket's own landing page (not meant for self-hosted instances); the
   * dedicated /login and /signup pages still exist for links and invites.
   * Sign-up follows the instance policy: open shows the form, invite-only
   * asks for the code, closed offers only log in.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, authApi, ApiError } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import { site, loadSite, siteHost, HANDLE_RULES } from '$lib/site.svelte';
  import Tabs from './Tabs.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';

  let { initial = 'signup' }: { initial?: 'signup' | 'login' } = $props();
  // svelte-ignore state_referenced_locally
  let mode = $state<'signup' | 'login'>(initial);
  let handle = $state('');
  let password = $state('');
  let inviteCode = $state('');
  let busy = $state(false);
  let error = $state<{ message: string; field?: string } | null>(null);

  const handleClean = $derived(handle.trim().toLowerCase().replace(/^@/, ''));
  const handleOk = $derived(/^[a-z0-9][a-z0-9_-]{1,29}$/.test(handleClean));
  // The rules only show once what's typed breaks them; still being too short while typing doesn't count.
  const handleBroken = $derived(handleClean.length > 30 || (handleClean !== '' && !/^[a-z0-9][a-z0-9_-]*$/.test(handleClean)));
  const status = $derived(site.status);
  const needsInvite = $derived(status?.signups === 'invite');
  const closed = $derived(status?.signups === 'closed');
  // An error about a field this form isn't showing still has to be seen, so it goes under the form.
  const errorOnField = $derived(error?.field === 'handle' || error?.field === 'password' || (error?.field === 'inviteCode' && mode === 'signup' && needsInvite));
  const canSignup = $derived(handleOk && password.length >= 8 && (!needsInvite || inviteCode.trim().length > 0));
  const TABS = $derived([
    { value: 'signup', label: 'Sign up', disabled: closed },
    { value: 'login', label: 'Log in' }
  ]);

  onMount(() => {
    loadSite().then((s) => { if (s.signups === 'closed') mode = 'login'; });
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
      // The policy changed while the form was open (say, to invite-only): catch up so the form matches.
      // Closed outright: switch to Log in, where the closed note says it.
      if (e instanceof ApiError && e.status === 403) {
        void loadSite().then((s) => { if (s.signups === 'closed') { mode = 'login'; error = null; } });
      }
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
    label="Sign up or log in"
    panel="auth-panel"
    fill
  />

  <div id="auth-panel" role="tabpanel">
    {#if !(mode === 'signup' && closed)}
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
          hint={mode === 'signup' ? (handleBroken ? HANDLE_RULES : `You’ll log in with this. Your page will be ${siteHost(status)}/@${handleClean || 'you'}.`) : undefined}
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
        {#if error && !errorOnField}<p class="bad" role="alert">{error.message}</p>{/if}
        <button type="submit" class="go" disabled={busy || (mode === 'signup' ? !canSignup : !handleClean || !password)}>
          {busy ? (mode === 'signup' ? 'Signing up…' : 'Logging in…') : mode === 'signup' ? 'Sign up' : 'Log in'}
        </button>
      </form>
      <!-- This box is thicket's own marketing: sign ups there are always open, so it
           carries no notes about invites or closed sign ups, and no instance name. -->
      {#if mode === 'signup'}
        <p class="note">All you need is a handle and a password.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .box { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: var(--space-4); }
  .box :global(.tabs) { margin-bottom: var(--space-4); }
  form { display: flex; flex-direction: column; gap: var(--space-3); }
  /* 2px is an optical nudge that lifts the button off the last field. */
    .go { margin-top: 2px; padding: var(--space-3); border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  .go:disabled { opacity: 0.5; }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .note { margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
</style>
