<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one labelled field. Everything around a single control: its name above
   * it, then the note that explains it (read before typing, so it sits between
   * the name and the control), and under the control whatever went wrong. It draws none of the control itself — it hands the control the three
   * things it needs to be announced properly (its id, what describes it, and
   * whether it is in error) and lets the control draw itself.
   *
   * A label is always written, even when it isn't shown: `hideLabel` keeps it
   * for screen readers only, which is what a search box with a magnifier and a
   * placeholder wants.
   *
   * An error appears under the control while it lasts, is announced the moment
   * it appears, and turns the control red. The hint stays put above.
   *
   * `optional` adds a quiet "(optional)" after the name, for a field someone
   * can simply skip.
   */
  interface Props {
    /** What this field is called. Required, even when hidden. */
    label: string;
    /** Keep the name for screen readers but don't draw it. */
    hideLabel?: boolean;
    /** The steady note under the field, e.g. "At least 8 characters." */
    hint?: string;
    /** What went wrong. Shows under the control and marks it invalid. */
    error?: string | null;
    optional?: boolean;
    /** Only when the caller needs to know the id too; otherwise one is made. */
    id?: string;
    children: Snippet<[{ id: string; describedBy: string | undefined; invalid: boolean }]>;
    class?: string;
    [key: string]: unknown;
  }

  let {
    label,
    hideLabel = false,
    hint,
    error = null,
    optional = false,
    id: givenId,
    children,
    class: klass = '',
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const id = $derived(givenId ?? uid);
  const hintId = $derived(`${id}-hint`);
  const errorId = $derived(`${id}-error`);
  const describedBy = $derived([error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined);
  const invalid = $derived(!!error);
</script>

<div class="field {klass}" {...rest}>
  <label for={id} class:visually-hidden={hideLabel}>
    {label}{#if optional}<em>(optional)</em>{/if}
  </label>
  {#if hint}<p class="note" id={hintId}>{hint}</p>{/if}
  {@render children({ id, describedBy, invalid })}
  {#if error}<p class="note bad" id={errorId} role="alert">{error}</p>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  /* The name reads first: body size and full-strength ink, a step above the
     note under it, so name and note never look alike. */
  label {
    font-size: calc(var(--text-base) * var(--size-app));
    font-weight: 600;
    color: var(--text);
  }

  /* The "(optional)" marker: the same size as the name, but unemphasized and
     gray, so it reads as an aside rather than part of what the field is called. */
  label em {
    margin-left: var(--space-1);
    font-style: normal;
    font-weight: 400;
    color: var(--text-2);
  }

  /* The note under the field. --text-2, not the lightest gray: the lightest
     one fails the contrast floor on several of the color themes. */
  .note {
    margin: 0;
    font-size: calc(var(--text-sm) * var(--size-app));
    color: var(--text-2);
    line-height: 1.4;
  }
  .note.bad {
    color: var(--danger);
  }
</style>
