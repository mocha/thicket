<script lang="ts">
  /**
   * readthicket.com's sign-up form. Just for signing up: most people here are
   * new, so logging in is a quiet link under the button, to the log-in page.
   *
   * Two homes, one form: straight on the landing page's green, and on the
   * plain background of the sign-up page that every other page's Sign up
   * leads to. That one passes `next`, the page to go back to afterward (a
   * shared collection, say); the landing page lands you on Everything.
   * The line above the handle field builds your page's address as you type
   * ("readthicket.com/@you" until then), which says what a handle is. It sat
   * inside the box once, and an empty box read as filled in. Hints sit inside
   * the empty fields, the handle's included, as words that can't pass for a
   * handle someone typed. The button is full strength from the
   * start; anything missing or wrong is explained under its field after you
   * press it, rather than leaving a pale button that looks broken.
   *
   * Sign-ups on readthicket.com are always open, so there's no invite or
   * closed state here. It asks for an email, used only for password resets.
   * (A local copy that isn't set up as readthicket.com doesn't send it.)
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, authApi, ApiError } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import { site, loadSite, HANDLE_RULES } from '$lib/site.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Button from './Button.svelte';

  let { next = null, onGreen = true }: { next?: string | null; onGreen?: boolean } = $props();
  // Only a path on this site, so a crafted link can't send a new account elsewhere.
  const safeNext = $derived(next && next.startsWith('/') && !next.startsWith('//') ? next : null);

  let handle = $state('');
  let password = $state('');
  let email = $state('');
  let busy = $state(false);
  let error = $state<{ message: string; field?: string } | null>(null);

  const handleClean = $derived(handle.trim().toLowerCase().replace(/^@/, ''));
  const hosted = $derived(site.status?.hosted ?? false);
  // An error about a field this form isn't showing still has to be seen, so it goes under the form.
  const errorOnField = $derived(error?.field === 'handle' || error?.field === 'password' || error?.field === 'email');

  onMount(() => { void loadSite(); });

  /** What's missing or wrong before anything is sent, one problem at a time, in form order. */
  function problem(): { message: string; field: string } | null {
    if (!/^[a-z0-9][a-z0-9_-]{1,29}$/.test(handleClean)) return { field: 'handle', message: HANDLE_RULES };
    if (password.length < 8) return { field: 'password', message: 'Use at least 8 characters.' };
    if (!email.trim()) return { field: 'email', message: 'Add an email so you can reset your password if you forget it.' };
    return null;
  }

  async function submit() {
    if (busy) return;
    error = problem();
    if (error) return;
    busy = true;
    try {
      setMe(await authApi.signup(handleClean, password, undefined, undefined, hosted ? email.trim() : undefined));
      api.event('signed_up', { via: onGreen ? 'home' : 'signup_page', next: safeNext });
      await goto(safeNext ?? '/everything', { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? { message: e.message, field: e.field } : { message: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }
</script>

<div class="box" class:green={onGreen}>
  <form novalidate onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <Field label="Your handle" hint="Your page will be readthicket.com/@{handleClean || 'you'}" error={error?.field === 'handle' ? error.message : null}>
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} inset={onGreen} bind:value={handle} autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="Pick a short name" />
      {/snippet}
    </Field>
    <Field label="Password" error={error?.field === 'password' ? error.message : null}>
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} inset={onGreen} type="password" bind:value={password} autocomplete="new-password" placeholder="At least 8 characters" />
      {/snippet}
    </Field>
    <Field label="Email" error={error?.field === 'email' ? error.message : null}>
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} inset={onGreen} type="email" bind:value={email} autocomplete="email" placeholder="Only used to reset your password" />
      {/snippet}
    </Field>
    {#if error && !errorOnField}<p class="bad" role="alert">{error.message}</p>{/if}
    <!-- The main button as the dark theme draws it (sage, dark lettering): on the dark green
         it stands apart from the cream fields. -->
    <span class="go"><Button type="submit" variant="primary" solid size="lg" loading={busy}>{busy ? 'Signing up…' : 'Sign up'}</Button></span>
  </form>
  <div class="after">
    <p>Free, with no ads and no tracking</p>
    <p>Already have an account? <a href="/login{safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}">Log in</a></p>
  </div>
</div>

<style>
  /* No card of its own. On the landing page's green, the labels and small
     lines read in cream, and the fields stay light, so they're still plainly
     fields. On the sign-up page it's ordinary ink on the page background. */
  .box.green { --on-green: #f6f1e8; --on-green-2: color-mix(in srgb, #f6f1e8 78%, transparent); --on-green-danger: #e38c7d; color: var(--on-green); }
  .green :global(label) { color: var(--on-green); }
  /* The dark theme's danger red, a shade paler: the light theme's is too dim on
     the green, and the dark one's fell just short of 4.5:1 on the green's lighter patches. */
  .green :global(.note) { color: var(--on-green-2); }
  .green :global(.note.bad) { color: var(--on-green-danger); }
  form { display: flex; flex-direction: column; gap: var(--space-4); }
  .go { display: flex; flex-direction: column; }
  .green .go { --accent: var(--d-accent); --accent-ink: var(--d-accent-ink); }
  .bad { color: var(--danger); margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .green .bad { color: var(--on-green-danger); }
  .after { margin-top: var(--space-4); display: flex; flex-direction: column; gap: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .green .after { color: var(--on-green-2); }
  .after p { margin: 0; }
  .after a { color: var(--accent); font-weight: 600; }
  .green .after a { color: var(--on-green); text-decoration: underline; text-underline-offset: 3px; }
</style>
