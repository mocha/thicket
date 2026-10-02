<script lang="ts">
  /**
   * Contact (issue #159), part of the marketing site and readthicket.com
   * only: a short form anyone can send, signed in or not. The message is
   * emailed to us with their address as the reply address; ours never appears
   * on the site. The footer links here.
   *
   * Like the sign-up form, the button is full strength from the start, and
   * anything missing is explained under its field after it's pressed. If the
   * message doesn't go out, the form says so and keeps what was typed.
   */
  import { contactApi, ApiError } from '$lib/api';
  import MarketingPage from '$lib/components/MarketingPage.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import Button from '$lib/components/Button.svelte';

  /** The same room the server allows (MAX_LENGTH.contact). */
  const LIMIT = 5000;

  let name = $state('');
  let email = $state('');
  let message = $state('');
  /** A box people never see. Only a script fills it in, and the server drops what it sends. */
  let website = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let error = $state<{ message: string; field?: string } | null>(null);
  const errorOnField = $derived(error?.field === 'name' || error?.field === 'email' || error?.field === 'message');

  /** What's missing before anything is sent, one problem at a time, in form order. */
  function problem(): { message: string; field: string } | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { field: 'email', message: 'Enter your email, so we can write back.' };
    if (!message.trim()) return { field: 'message', message: 'Write a message first.' };
    if (message.trim().length > LIMIT) return { field: 'message', message: `That’s longer than ${LIMIT.toLocaleString('en-US')} characters. Trim it a little, or send it in two parts.` };
    return null;
  }

  async function submit() {
    if (busy) return;
    error = problem();
    if (error) return;
    busy = true;
    try {
      await contactApi.send(name.trim(), email.trim(), message.trim(), website);
      sent = true;
    } catch (e) {
      error = e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Contact · thicket</title></svelte:head>

<MarketingPage>
  {#if sent}
    <div role="status">
      <h1>Thanks for writing</h1>
      <p>Your message is on its way to us. We’ll reply to {email.trim()}.</p>
    </div>
  {:else}
    <h1>Contact us</h1>
    <p>Questions, ideas, or something not working? Write to us, and we’ll reply by email.</p>
    <div class="box">
      <form novalidate onsubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Your name" optional error={error?.field === 'name' ? error.message : null}>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={name} autocomplete="name" disabled={busy} />
          {/snippet}
        </Field>
        <Field label="Your email" error={error?.field === 'email' ? error.message : null}>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} inset type="email" bind:value={email} autocomplete="email" placeholder="Only used to reply to you" disabled={busy} />
          {/snippet}
        </Field>
        <Field label="Your message" error={error?.field === 'message' ? error.message : null}>
          {#snippet children({ id, describedBy, invalid })}
            <Textarea {id} aria-describedby={describedBy} {invalid} inset bind:value={message} rows={7} limit={LIMIT} disabled={busy} />
          {/snippet}
        </Field>
        <!-- Not for people: off screen, skipped by Tab and by screen readers. -->
        <div class="trap" aria-hidden="true"><label>Website <input type="text" bind:value={website} tabindex="-1" autocomplete="off" /></label></div>
        {#if error && !errorOnField}<p class="bad" role="alert">{error.message}</p>{/if}
        <!-- The main button as the dark theme draws it, like Sign up on the landing page. -->
        <span class="go"><Button type="submit" variant="primary" solid size="lg" loading={busy}>{busy ? 'Sending…' : 'Send'}</Button></span>
      </form>
    </div>
  {/if}
</MarketingPage>

<style>
  /* The form sits straight on the green, like the landing page's sign-up
     form: labels and small lines in cream, the fields light. */
  .box { --on-green: #f6f1e8; --on-green-danger: #e38c7d; color: var(--on-green); max-width: 30rem; margin-top: var(--space-5); }
  .box :global(label) { color: var(--on-green); }
  .box :global(label em) { color: color-mix(in srgb, #f6f1e8 78%, transparent); }
  .box :global(.note.bad) { color: var(--on-green-danger); }
  form { display: flex; flex-direction: column; gap: var(--space-4); }
  .go { display: flex; flex-direction: column; --accent: var(--d-accent); --accent-ink: var(--d-accent-ink); }
  .box .bad { color: var(--on-green-danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .trap { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
</style>
