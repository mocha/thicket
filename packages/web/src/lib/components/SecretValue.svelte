<script lang="ts">
  /**
   * A secret shown in a box to copy from: an API token, a temporary password.
   * Monospace, on the quiet gray of a text field, and selected whole with one
   * click. Hidden, it keeps its first `keep` characters and dots the rest, on
   * one line; shown, it wraps so the whole value can be read and selected.
   * The buttons about it (Show, Copy) are the caller's, beside the box.
   */
  let { value, shown = true, keep = 7, label }: { value: string; shown?: boolean; keep?: number; label: string } = $props();
</script>

<code class="secret" class:shown aria-label={shown ? label : `${label}, hidden`}>{shown ? value : value.slice(0, keep) + '•'.repeat(24)}</code>

<style>
  .secret {
    flex: 1 1 16rem; min-width: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
    background: var(--surface-2); border: 1px solid var(--line);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: calc(var(--text-sm) * var(--size-app));
    color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: all;
  }
  /* Shown, the whole value has to be readable and selectable, so it wraps instead of trailing off. */
  .secret.shown { white-space: normal; overflow-wrap: anywhere; color: var(--text); }
</style>
