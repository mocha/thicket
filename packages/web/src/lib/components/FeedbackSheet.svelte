<script lang="ts">
  /**
   * Send feedback (issue #153, readthicket.com only), in a sheet opened from
   * the account menu: one box, one button. What you write goes to the people
   * who run thicket, and nowhere public. The page you were on goes with it, so
   * "this is broken" doesn't need a description of where. Your handle goes
   * with it only if you tick the box.
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, feedbackApi } from '$lib/api';
  import { closeFeedback } from '$lib/feedback.svelte';
  import { session } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Sheet from './Sheet.svelte';
  import Field from './Field.svelte';
  import Textarea from './Textarea.svelte';

  /** The same room the server allows (MAX_LENGTH.feedback). */
  const LIMIT = 2000;

  let dialog = $state<HTMLDialogElement | null>(null);
  let box = $state<HTMLTextAreaElement | null>(null);
  let text = $state('');
  /** Off unless they tick it: feedback goes without a name by default. */
  let includeHandle = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    dialog?.showModal();
    queueMicrotask(() => box?.focus());
  });

  async function send() {
    const value = text.trim();
    if (!value || busy || value.length > LIMIT) return;
    busy = true; error = null;
    try {
      await feedbackApi.send(value, page.url.pathname, includeHandle);
      api.event('feedback_sent');
      showToast('Thanks! We read every one');
      dialog?.close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Send feedback" bind:dialog onclose={closeFeedback}>
  <form id="send-feedback" class="form" onsubmit={(e) => { e.preventDefault(); void send(); }}>
    <p class="lede">Something broken, confusing, or missing? Tell us. Only the people who make thicket will see what you write.</p>
    <Field label="Your feedback" hideLabel {error}>
      {#snippet children({ id, describedBy, invalid })}
        <Textarea {id} aria-describedby={describedBy} {invalid} bind:element={box} bind:value={text} inset rows={6} limit={LIMIT} disabled={busy} placeholder="What happened, or what would you like?" />
      {/snippet}
    </Field>
    <!-- Directly under the box. The count shares the row, and only once there is
         little room left: until then it is one more thing to read. -->
    <div class="under">
      <label class="handle">
        <input type="checkbox" bind:checked={includeHandle} disabled={busy} />
        <span>Include your handle (@{session.user?.handle}), so we can follow up</span>
      </label>
      {#if text.length > LIMIT * 0.9}<span class="count" class:over={text.length > LIMIT} role="status">{text.length}/{LIMIT}</span>{/if}
    </div>
  </form>
  {#snippet footer()}
    <button type="submit" form="send-feedback" class="sheet-action" disabled={busy || !text.trim() || text.length > LIMIT}>{busy ? 'Sending…' : 'Send'}</button>
  {/snippet}
</Sheet>

<style>
  /* The form is only here to make the button submit; its children lay out as the Sheet's own. */
  .form { display: contents; }
  /* Pulled up against the title so the two read as one block. */
  .lede { color: var(--text-2); margin: calc(-1 * var(--space-2)) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  /* Tucked up under the box: a step closer than the Sheet spaces its parts. */
  .under { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: calc(-1 * var(--space-1)); }
  .count { flex: none; font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-2); font-variant-numeric: tabular-nums; }
  .count.over { color: var(--danger); font-weight: 700; }
  /* The same tick box as "Create this collection" on the import page. */
  .handle { display: flex; align-items: center; gap: var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); cursor: pointer; }
  .handle input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--accent); }
  .handle input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
