<script lang="ts">
  /**
   * The way back to where a post came from. Opens the publisher's original in
   * a new tab — the one press that's always available under a post, whether
   * what's shown here is the full text or just a preview. The main Button,
   * large, so it's the most prominent thing wherever it sits.
   */
  import Button from './Button.svelte';

  interface Props {
    href: string;
    label?: string;
    [key: string]: unknown;
  }
  let { href, label = 'Read on original site', ...rest }: Props = $props();
</script>

<Button variant="primary" size="lg" {href} target="_blank" rel="noopener" {...rest}>{label} <span aria-hidden="true">↗</span></Button>
