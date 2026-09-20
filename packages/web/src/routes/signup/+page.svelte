<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, authApi, ApiError, type InstanceStatus } from '$lib/api';
  import { setMe } from '$lib/session.svelte';

  /**
   * Sign-up is a handle and a password. Everything on the profile is optional
   * and can be filled in later (or never), so a new person lands on an empty
   * Everything with the one thing that matters: Add a feed.
   */
  let handle = $state('');
  let password = $state('');
  let displayName = $state('');
  let busy = $state(false);
  let status = $state<InstanceStatus | null>(null);
  let inviteCode = $state('');
  let error = $state<{ message: string; field?: string } | null>(null);

  const handleClean = $derived(handle.trim().toLowerCase().replace(/^@/, ''));
  const handleOk = $derived(/^[a-z0-9][a-z0-9_-]{1,29}$/.test(handleClean));

  async function submit() {
    if (busy) return;
    busy = true; error = null;
    try {
      const me = await authApi.signup(handleClean, password, displayName.trim() || undefined, inviteCode.trim() || undefined);
      setMe(me);
      api.event('signed_up');
      // Back to whatever brought you here (someone's collection, say), else Everything.
      const next = page.url.searchParams.get('next');
      await goto(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    inviteCode = page.url.searchParams.get('invite') ?? '';
    authApi.status().then((s) => (status = s)).catch(() => (status = { name: 'thicket', url: '', signups: 'open', visitorLimit: true, billing: false }));
  });
  const needsInvite = $derived(status?.signups === 'invite');
  const canSubmit = $derived(handleOk && password.length >= 8 && (!needsInvite || inviteCode.trim().length > 0));
</script>

<svelte:head><title>Sign up · thicket</title></svelte:head>

<section class="auth">
  <h1>Make an account{#if status?.name}{" on "}{status.name}{/if}</h1>
  <p class="lede">A handle and a password. Everything else is optional, and you can start following feeds right away.</p>
  {#if !status}
    <p class="lede">Loading…</p>
  {:else if status.signups === 'closed'}
    <p class="bad">Sign-ups are closed on this instance.</p>
  {:else if needsInvite && !inviteCode}
    <p class="bad">This instance is invite-only. Ask a member for an invite link; it will bring you back here.</p>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
      {#if needsInvite}
        <label class:err={error?.field === 'inviteCode'}>
          <span>Invite code</span>
          <input type="text" bind:value={inviteCode} autocapitalize="off" spellcheck="false" required />
        </label>
      {/if}
      <label class:err={error?.field === 'handle'}>
        <span>Handle</span>
        <span class="at"><span aria-hidden="true">@</span><input type="text" bind:value={handle} autocomplete="username" autocapitalize="off" spellcheck="false" required placeholder="you" /></span>
        <small>Your page will be <strong>/@{handleClean || 'you'}</strong>. Lowercase letters, numbers, - and _.</small>
      </label>
      <label class:err={error?.field === 'password'}>
        <span>Password</span>
        <input type="password" bind:value={password} autocomplete="new-password" required minlength="8" />
        <small>At least 8 characters.</small>
      </label>
      <label>
        <span>Display name <em>optional</em></span>
        <input type="text" bind:value={displayName} autocomplete="name" placeholder="How you’d like to appear" />
      </label>
      {#if error}<p class="bad" role="alert">{error.message}</p>{/if}
      <button type="submit" disabled={busy || !canSubmit}>{busy ? 'Creating…' : 'Create account'}</button>
    </form>
  {/if}
  <p class="alt">Already have one? <a href="/login{page.url.search}">Log in</a></p>

  <aside class="what">
    <h2>What you’re joining</h2>
    <p>A reader, not a network. You pick the sites; thicket shows you what they published, newest first, with nothing reordered and nothing inserted. We don’t track what you read or keep a history you didn’t ask us to save.</p>
    <p>Your collections can be copied to any other instance, so you are never locked in — and if you ever dislike how this one is run, thicket is open source and you can run your own.</p>
  </aside>
</section>

<style>
  .auth { max-width: 380px; margin: 40px auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(30px * var(--size-headings)); margin: 0 0 6px; }
  .lede { color: var(--text-2); margin: 0 0 20px; }
  form { display: flex; flex-direction: column; gap: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: calc(13px * var(--size-app)); font-weight: 600; color: var(--text-2); }
  label em { font-weight: 400; color: var(--text-3); font-style: normal; margin-left: 4px; }
  small { font-weight: 400; color: var(--text-3); }
  small strong { color: var(--text-2); }
  input { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: calc(16px * var(--size-app)); width: 100%; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .at { display: flex; align-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); padding-left: 12px; color: var(--text-3); font-size: calc(16px * var(--size-app)); }
  .at input { border: 0; padding-left: 2px; }
  .at:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
  .at input:focus { outline: none; }
  .err input, .err .at { border-color: var(--danger); }
  button { margin-top: 4px; padding: 13px; border-radius: 12px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(16px * var(--size-app)); }
  button:disabled { opacity: 0.5; }
  .bad { color: var(--danger); margin: 0; font-size: calc(14px * var(--size-app)); }
  .alt { margin: 22px 0 0; color: var(--text-2); }
  .what { margin: 28px 0 0; padding-top: 18px; border-top: 1px solid var(--line); }
  .what h2 { font-family: var(--font-headings); font-size: calc(17px * var(--size-headings)); margin: 0 0 7px; }
  .what p { margin: 0 0 9px; color: var(--text-2); font-size: calc(14px * var(--size-app)); line-height: 1.5; }
  .what p:last-child { margin-bottom: 0; }
  .alt a { color: var(--accent); font-weight: 600; }
</style>
