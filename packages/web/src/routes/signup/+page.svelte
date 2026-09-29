<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, authApi, ApiError } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import { site, loadSite, HANDLE_RULES } from '$lib/site.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';

  /**
   * Sign-up is a handle and a password, plus an email on readthicket.com (for
   * password resets only). Everything on the profile is optional
   * and can be filled in later (or never), so a new person lands on an empty
   * Everything with the one thing that matters: Add a feed.
   */
  let handle = $state('');
  let password = $state('');
  let displayName = $state('');
  let email = $state('');
  let busy = $state(false);
  const status = $derived(site.status);
  let inviteCode = $state('');
  let error = $state<{ message: string; field?: string } | null>(null);

  const handleClean = $derived(handle.trim().toLowerCase().replace(/^@/, ''));
  const handleOk = $derived(/^[a-z0-9][a-z0-9_-]{1,29}$/.test(handleClean));
  // The rules only show once what's typed breaks them; still being too short while typing doesn't count.
  const handleBroken = $derived(handleClean.length > 30 || (handleClean !== '' && !/^[a-z0-9][a-z0-9_-]*$/.test(handleClean)));

  async function submit() {
    if (busy) return;
    busy = true; error = null;
    try {
      const me = await authApi.signup(handleClean, password, displayName.trim() || undefined, inviteCode.trim() || undefined, hosted ? email.trim() : undefined);
      setMe(me);
      api.event('signed_up');
      // Back to whatever brought you here (someone's collection, say), else Everything.
      const next = page.url.searchParams.get('next');
      await goto(next && next.startsWith('/') && !next.startsWith('//') ? next : '/everything', { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) };
      // The policy changed while the form was open (say, to invite-only): catch up so the form matches.
      if (e instanceof ApiError && e.status === 403) void loadSite();
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    inviteCode = page.url.searchParams.get('invite') ?? '';
    void loadSite();
  });
  const needsInvite = $derived(status?.signups === 'invite');
  const hosted = $derived(status?.hosted ?? false);
  // An error about a field this form isn't showing still has to be seen, so it goes under the form.
  const errorOnField = $derived(error?.field === 'handle' || error?.field === 'password' || (error?.field === 'email' && hosted) || (error?.field === 'inviteCode' && needsInvite));
  const canSubmit = $derived(handleOk && password.length >= 8 && (!hosted || email.trim().length > 0) && (!needsInvite || inviteCode.trim().length > 0));
</script>

<svelte:head><title>Sign up · thicket</title></svelte:head>

<section class="auth">
  <h1>Sign up for thicket</h1>
  <p class="lede">{hosted ? 'All you need is a handle, a password, and an email.' : 'All you need is a handle and a password.'} You can start following feeds right away.</p>
  {#if !status}
    <p class="lede">Loading…</p>
  {:else if status.signups === 'closed'}
    <p class="bad">Sign ups are closed for {status.name}.</p>
  {:else if needsInvite && !inviteCode}
    <p class="bad">You need an invite to sign up for {status.name}. Ask someone who already has an account to send you an invite link. It will bring you back here.</p>
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
        hint={handleBroken ? HANDLE_RULES : `You’ll log in with this. Your page will be readthicket.com/@${handleClean || 'you'}.`}
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
      {#if hosted}
        <Field label="Email" hint="Only for resetting your password if you forget it. We’ll send you a link to confirm it." error={error?.field === 'email' ? error.message : null}>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} type="email" bind:value={email} autocomplete="email" required />
          {/snippet}
        </Field>
      {/if}
      <Field label="Display name" optional hint="The name people see instead of your handle. You can change it at any time.">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} bind:value={displayName} autocomplete="name" />
        {/snippet}
      </Field>
      {#if error && !errorOnField}<p class="bad" role="alert">{error.message}</p>{/if}
      <Button type="submit" variant="primary" solid size="lg" disabled={busy || !canSubmit} loading={busy}>{busy ? 'Signing up…' : 'Sign up'}</Button>
    </form>
  {/if}
  <p class="alt">Already have an account? <a href="/login{page.url.search}">Log in</a></p>

  <aside class="what">
    <h2>What you’re joining</h2>
    <p>You pick the sites, and thicket shows you everything they publish, newest first. Nothing is reordered, and nothing is added. We don’t track what you read or keep a history you didn’t ask us to save.</p>
    <p>thicket is open source, so other people run their own thicket sites, and you can, too. You can copy your collections to any of them, so you’re never locked in.</p>
  </aside>
</section>

<style>
  .auth { max-width: 380px; margin: calc(var(--space-6) + var(--space-2)) auto 0; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .lede { color: var(--text-2); margin: 0 0 var(--space-5); }
  form { display: flex; flex-direction: column; gap: var(--space-5); }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .alt { margin: var(--space-5) 0 0; color: var(--text-2); }
  .what { margin: calc(var(--space-5) + var(--space-1)) 0 0; padding-top: var(--space-4); border-top: 1px solid var(--line); }
  .what h2 { font-family: var(--font-headings); font-size: calc(var(--text-base) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .what p { margin: 0 0 var(--space-2); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.5; }
  .what p:last-child { margin-bottom: 0; }
  .alt a { color: var(--accent); font-weight: 600; }
</style>
