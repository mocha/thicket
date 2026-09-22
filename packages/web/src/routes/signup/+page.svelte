<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, authApi, ApiError, type InstanceStatus } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';

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
    authApi.status().then((s) => (status = s)).catch(() => (status = { name: 'thicket', url: '', signups: 'open', visitorLimit: true }));
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
        <Field label="Invite code" error={error?.field === 'inviteCode' ? error.message : null}>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} bind:value={inviteCode} autocapitalize="off" spellcheck="false" required />
          {/snippet}
        </Field>
      {/if}
      <Field
        label="Handle"
        hint="Your page will be /@{handleClean || 'you'}. Lowercase letters, numbers, - and _."
        error={error?.field === 'handle' ? error.message : null}
      >
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
      <Field label="Password" hint="At least 8 characters." error={error?.field === 'password' ? error.message : null}>
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} type="password" bind:value={password} autocomplete="new-password" required minlength="8" />
        {/snippet}
      </Field>
      <Field label="Display name" optional>
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} bind:value={displayName} autocomplete="name" placeholder="How you’d like to appear" />
        {/snippet}
      </Field>
      {#if error && !error.field}<p class="bad" role="alert">{error.message}</p>{/if}
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
  .auth { max-width: 380px; margin: calc(var(--space-6) + var(--space-2)) auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .lede { color: var(--text-2); margin: 0 0 var(--space-5); }
  form { display: flex; flex-direction: column; gap: var(--space-4); }
  button { margin-top: var(--space-1); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  button:disabled { opacity: 0.5; }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .alt { margin: var(--space-5) 0 0; color: var(--text-2); }
  .what { margin: calc(var(--space-5) + var(--space-1)) 0 0; padding-top: var(--space-4); border-top: 1px solid var(--line); }
  .what h2 { font-family: var(--font-headings); font-size: calc(var(--text-base) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .what p { margin: 0 0 var(--space-2); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.5; }
  .what p:last-child { margin-bottom: 0; }
  .alt a { color: var(--accent); font-weight: 600; }
</style>
