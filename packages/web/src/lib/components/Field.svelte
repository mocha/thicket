<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one labelled field. Everything around a single control: its name above
   * it, and under it either the note that explains it or the thing that went
   * wrong. It draws none of the control itself — it hands the control the three
   * things it needs to be announced properly (its id, what describes it, and
   * whether it is in error) and lets the control draw itself.
   *
   * A label is always written, even when it isn't shown: `hideLabel` keeps it
   * for screen readers only, which is what a search box with a magnifier and a
   * placeholder wants.
   *
   * An error replaces the hint while it lasts, is announced the moment it
   * appears, and turns the control red.
   *
   * `optional` adds the quiet "optional" marker after the name, for a field
   * someone can simply skip.
   */
  interface Props {
    /** What this field is called. Required, even when hidden. */
    label: string;
    /** Keep the name for screen readers but don't draw it. */
    hideLabel?: boolean;
    /** The steady note under the field, e.g. "At least 8 characters." */
    hint?: string;
    /** What went wrong. Replaces the hint and marks the control invalid. */
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
  const noteId = $derived(`${id}-note`);
  const note = $derived(error || hint);
  const describedBy = $derived(note ? noteId : undefined);
  const invalid = $derived(!!error);
</script>

<div class="field {klass}" {...rest}>
  <label for={id} class:visually-hidden={hideLabel}>
    {label}{#if optional}<em>optional</em>{/if}
  </label>
  {@render children({ id, describedBy, invalid })}
  {#if error}
    <p class="note bad" id={noteId} role="alert">{error}</p>
  {:else if hint}
    <p class="note" id={noteId}>{hint}</p>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  label {
    font-size: calc(var(--text-sm) * var(--size-app));
    font-weight: 600;
    color: var(--text-2);
  }

  /* The "optional" marker: the same small size as the name, but unemphasised,
     so it reads as an aside rather than part of what the field is called. */
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
