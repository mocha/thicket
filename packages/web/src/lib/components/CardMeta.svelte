<script lang="ts">
  import type { Snippet } from 'svelte';
  import { relativeTime } from '$lib/time';
  import SourceIcon from './SourceIcon.svelte';

  /**
   * The small line at the top of a card: the site's icon, its name, and how
   * long ago the post went up. One line, one look, on every card.
   *
   * The time is always a real date underneath — hovering it shows the full
   * date and time, and it reads as a date to anything parsing the page.
   *
   * Pass `onsource` and the name becomes a button that opens the feed's card;
   * without it the name is plain text. Anything else that belongs on the line
   * (a "New" mark, say) is passed as children and lands after the time.
   */
  interface Props {
    feedId: number | null;
    hasIcon?: boolean;
    name: string | null;
    /** When the post went up. Left off when there is no date to show. */
    when?: string | null;
    /** Given, the source name becomes a button. */
    onsource?: () => void;
    children?: Snippet;
    class?: string;
    [key: string]: unknown;
  }

  let { feedId, hasIcon = false, name, when = null, onsource, children, class: klass = '', ...rest }: Props = $props();

  /** One icon size on every card. */
  const ICON = 20;
</script>

<div class="meta {klass}" {...rest}>
  {#if onsource}
    <button class="source" onclick={onsource} title="About {name}">
      <SourceIcon {feedId} {hasIcon} {name} size={ICON} />
      <span class="name">{name}</span>
    </button>
  {:else}
    <SourceIcon {feedId} {hasIcon} {name} size={ICON} />
    <span class="name">{name}</span>
  {/if}
  {#if when}
    <span class="dot">·</span>
    <time datetime={when} title={new Date(when).toLocaleString()}>{relativeTime(when)}</time>
  {/if}
  {@render children?.()}
</div>

<style>
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: calc(var(--text-sm) * var(--size-app));
    color: var(--text-2);
  }
  .source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-1) 6px var(--space-1) 0;
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .source:hover { background: var(--surface-2); }
  .name {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot { color: var(--text-3); }
  time { color: var(--text-3); white-space: nowrap; }
</style>
