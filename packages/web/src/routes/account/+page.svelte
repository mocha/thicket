<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { api, authApi, bookmarksApi, ApiError } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { site, loadSite } from '$lib/site.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import ApiTokens from '$lib/components/ApiTokens.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * How you get into your account, and back in: your email and your password.
   * And, at the bottom, how your own applications get in: API tokens.
   * Settings is for how thicket reads; this page is for the account itself.
   *
   * The Email section is readthicket.com only. Self-hosted copies don't ask for
   * email (their admin runs their users), so there this page is just the
   * password.
   *
   * Unlike Settings, nothing here saves as you type: each change asks you to
   * confirm it with your password or a button.
   *
   * It is where you bring your reading in from somewhere else: Import feeds,
   * a door to the import page, which used to be in the account menu.
   *
   * It is also where you take your things with you: Export my data, one row
   * per thing you can download (issue #135). Bookmarks and notes are the
   * first; collections get a row of their own when all of them can be
   * exported at once, and until then a line says where to export each one.
   */
  const me = $derived(session.user!);

  /**
   * Who may turn on API tokens (issue #140). Everyone, today. This is the one
   * line to change when that depends on something about the account: make it
   * false, and pass `unavailable` to say why, and the section shows itself
   * switched off.
   */
  const tokensAvailable = $derived(true);
  $effect(() => { if (!site.status) void loadSite(); });
  const hosted = $derived(site.status?.hosted ?? false);
  const confirmed = $derived(!!me.emailConfirmedAt);

  type Err = { message: string; field?: string } | null;
  const toErr = (e: unknown): Err => (e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) });

  // ---- email ----
  let editing = $state(false);
  let email = $state('');
  let emailPw = $state('');
  let emailError = $state<Err>(null);
  let emailBusy = $state(false);
  /** Shown even when no form is open: the address saved but its confirmation didn't send. */
  let sendError = $state<string | null>(null);
  const formOpen = $derived(editing || !me.email);

  function startEdit() { editing = true; email = ''; emailPw = ''; emailError = null; }
  function cancelEdit() { editing = false; emailError = null; }

  async function saveEmail() {
    if (emailBusy) return;
    emailBusy = true; emailError = null; sendError = null;
    const had = confirmed ? me.email : null;
    try {
      const r = await authApi.setEmail(email.trim(), emailPw);
      setMe(r.me);
      editing = false; emailPw = '';
      if (!r.sent) sendError = r.error ?? null;
      else showToast(had ? `Check ${email.trim()} for a confirmation link. Until you confirm it, reset links still go to ${had}.` : 'Check your inbox for a link to confirm your email.');
    } catch (e) {
      emailError = toErr(e);
    } finally {
      emailBusy = false;
    }
  }

  let resendBusy = $state(false);
  async function resend() {
    if (resendBusy) return;
    resendBusy = true; sendError = null;
    try {
      const r = await authApi.resendEmail();
      showToast(`We sent another link to ${r.email}.`);
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    } finally {
      resendBusy = false;
    }
  }

  // ---- export ----
  /* How many bookmarks there are and the most one file holds, to say so when
     an export would stop short. Until it answers, or if it can't, nothing is
     said and the button still works. */
  let exportInfo = $state<{ count: number; limit: number } | null>(null);
  $effect(() => { void bookmarksApi.exportInfo().then((i) => (exportInfo = i)).catch(() => {}); });
  const capped = $derived(exportInfo !== null && exportInfo.count > exportInfo.limit);

  // ---- password (moved from Settings) ----
  let current = $state('');
  let next = $state('');
  /* The server says which of the two boxes is wrong — a mistyped current
     password, or a new one that's too short — so the message lands on that
     box. Anything else (the network, say) is about neither, so it sits under
     the pair. */
  let pwError = $state<Err>(null);
  let pwBusy = $state(false);
  async function changePassword() {
    if (pwBusy) return;
    pwBusy = true; pwError = null;
    try {
      await authApi.changePassword(current, next);
      current = ''; next = '';
      showToast('Password changed. Other devices were signed out.');
    } catch (e) {
      pwError = toErr(e);
    } finally {
      pwBusy = false;
    }
  }

  /* Forgot the current password while signed in (issue #124): the same reset
     link /forgot-password sends, without logging out first. Only to a
     confirmed address, as there. */
  let resetBusy = $state(false);
  let resetError = $state<string | null>(null);
  async function sendReset() {
    if (resetBusy) return;
    resetBusy = true; resetError = null;
    try {
      await authApi.forgotPassword(me.handle);
      // This endpoint acknowledges requests even when throttled or delivery fails.
      showToast(`Reset link requested for ${me.email}. Check your inbox. If a link arrives, it expires in 1 hour.`);
    } catch (e) {
      resetError = e instanceof Error ? e.message : String(e);
    } finally {
      resetBusy = false;
    }
  }
</script>

<svelte:head><title>Account · thicket</title></svelte:head>

<PageHeader name="Account">
  {#snippet description()}Your email, your password, and your data.{/snippet}
</PageHeader>

{#if hosted}
  <Card kind="section" as="section" class="account-section">
    <h2>Email</h2>
    <p class="help">If you forget your password, we’ll email you a link to reset it. We won’t send you anything else, and no one else can see this address.</p>

    <!-- The address and its one action share a row; the status, when there is
         one, is a single line under it with Resend as a link at its end. -->
    {#if me.email}
      <div class="address">
        <span class="who"><span class="addr">{me.email}</span>{#if !confirmed}<Badge>Not confirmed</Badge>{/if}</span>
        {#if !editing}<Button size="sm" onclick={startEdit}>Change</Button>{/if}
      </div>
      {#if !confirmed || me.pendingEmail}
        <p class="note">
          {#if !confirmed}Check your inbox for the link. It expires in 24 hours.{:else}Waiting for you to confirm {me.pendingEmail}. Until then, reset links still go here.{/if}
          <button type="button" class="link" onclick={resend} disabled={resendBusy}>{resendBusy ? 'Sending…' : 'Resend it'}</button>
        </p>
      {/if}
    {/if}

    {#if sendError}<p class="bad" role="alert">{sendError}</p>{/if}

    {#if formOpen}
      <form onsubmit={(e) => { e.preventDefault(); void saveEmail(); }}>
        <Field label={me.email ? 'New email address' : 'Email address'} error={emailError?.field === 'email' ? emailError.message : null}>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} inset type="email" bind:value={email} autocomplete="email" required />
          {/snippet}
        </Field>
        <Field label="Current password" hint="So no one else can change where your reset links go." error={emailError?.field === 'password' ? emailError.message : null}>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} inset type="password" bind:value={emailPw} autocomplete="current-password" required />
          {/snippet}
        </Field>
        {#if emailError && !emailError.field}<p class="bad" role="alert">{emailError.message}</p>{/if}
        <div class="row">
          {#if me.email}<Button variant="ghost" onclick={cancelEdit}>Cancel</Button>{/if}
          <Button type="submit" variant="primary" disabled={emailBusy || !email.trim() || !emailPw} loading={emailBusy}>{me.email ? 'Save new email' : 'Add email'}</Button>
        </div>
      </form>
    {/if}
  </Card>
{/if}

<Card kind="section" as="section" class="account-section">
  <h2>Change password</h2>
  <form onsubmit={(e) => { e.preventDefault(); void changePassword(); }}>
    <Field label="Current password" error={pwError?.field === 'current' ? pwError.message : null}>
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} inset type="password" bind:value={current} autocomplete="current-password" required />
      {/snippet}
    </Field>
    <Field label="New password" hint="At least 8 characters." error={pwError?.field === 'next' ? pwError.message : null}>
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} inset type="password" bind:value={next} autocomplete="new-password" required minlength={8} />
      {/snippet}
    </Field>
    {#if pwError && !pwError.field}<p class="bad" role="alert">{pwError.message}</p>{/if}
    <div class="row"><Button type="submit" disabled={pwBusy || !current || next.length < 8} loading={pwBusy}>{pwBusy ? 'Changing…' : 'Change password'}</Button></div>
  </form>
  {#if hosted && confirmed}
    <p class="note forgot">
      Forgot your current password?
      <button type="button" class="link" onclick={sendReset} disabled={resetBusy}>{resetBusy ? 'Sending…' : 'Email me a reset link'}</button>
    </p>
    {#if resetError}<p class="bad" role="alert">{resetError}</p>{/if}
  {/if}
</Card>

<!-- The way in sits beside the way out: bring your reading here, take it with
     you. The import itself is a page of its own (/import); this is its door. -->
<Card kind="section" as="section" class="account-section">
  <h2>Import feeds</h2>
  <div class="export">
    <div class="what">
      <p>From another reader, or a link to someone’s collection.</p>
    </div>
    <Button href="/import">Import feeds</Button>
  </div>
</Card>

<Card kind="section" as="section" class="account-section">
  <h2>Export my data</h2>

  <!-- One row per thing to download: what it is and what you get on the left,
       its button on the right. The next export gets a row of its own here. -->
  <div class="export">
    <div class="what">
      <p>Download your bookmarks and notes to keep, or to move to another bookmarking app.</p>
      {#if capped && exportInfo}<p>Your most recent {exportInfo.limit.toLocaleString('en-US')} only.</p>{/if}
    </div>
    <Button href={bookmarksApi.exportUrl()} download="thicket-bookmarks.html" onclick={() => api.event('bookmarks_exported', { count: exportInfo?.count })}>Export bookmarks</Button>
  </div>

  <p class="note also">To export a single collection, click its gear button to access its manage features.</p>
</Card>

<ApiTokens available={tokensAvailable} />

<style>
  /* The page has no element of its own around its sections, so the room between them is set on the cards' own class. */
  :global(.account-section) { margin-bottom: var(--space-4); }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0 0 var(--space-3); line-height: 1.25; }
  h2 + .help { margin-top: calc(-1 * var(--space-2)); }
  .help { margin: 0 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  .address { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .who { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
  .addr { font-weight: 600; overflow-wrap: anywhere; }
  .note { margin: var(--space-1) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  /* Resend reads as a link inside the sentence, like links in help text elsewhere. */
  .link { font: inherit; color: var(--accent); font-weight: 600; }
  .link:hover { text-decoration: underline; }
  .link:disabled { opacity: 0.6; }
  /* The form opening under an address needs room from it. */
  .address + form, .note + form { margin-top: var(--space-4); }
  .forgot { margin-top: var(--space-3); }
  form { display: flex; flex-direction: column; gap: var(--space-5); }
  .row { display: flex; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
  .bad { color: var(--danger); margin: var(--space-2) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  form .bad { margin: 0; }
  /* An export row: words on the left, the button on the right, the button
     dropping under the words on a phone. */
  .export { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .what { flex: 1 1 260px; min-width: 0; }
  .what p { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  .also { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line); }
</style>
