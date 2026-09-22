<script lang="ts">
  /**
   * The way back to where a post came from. Opens the publisher's original in
   * a new tab — the one press that's always available under a post, whether
   * what's shown here is the full text or just a preview.
   */
  interface Props {
    href: string;
    label?: string;
    [key: string]: unknown;
  }
  let { href, label = 'Read on original site', ...rest }: Props = $props();
</script>

<a class="out" {href} target="_blank" rel="noopener" {...rest}>{label} <span aria-hidden="true">↗</span></a>

<style>
  .out {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--space-3) calc(var(--space-4) + var(--space-1));
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
    font-size: calc(var(--text-base) * var(--size-app));
  }
  .out:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
