<script lang="ts">
  /**
   * One line under a row of tabs saying what the chosen tab shows: a small
   * icon and a short sentence, centered, in the accent color. It sits in the
   * same spot on every tab, so the tabs pick the view and this says what it
   * is. Explore uses it for what each search covers; a profile uses it to tell
   * its owner who can see the open tab.
   *
   * `icon` is drawn at 16px. Anything after the sentence (a "Change" link)
   * goes in `children`. `card`: it sits on a section card of its own, above
   * the tab's items, with the same room above and below it (a profile's tabs).
   */
  import type { Snippet } from 'svelte';
  import Card from './Card.svelte';
  import { noOrphan } from '$lib/orphans';

  let { text, icon, children, card = false, class: klass = '' }: { text: string; icon: Snippet; children?: Snippet; card?: boolean; class?: string } = $props();
</script>

{#snippet words()}<span class="i">{@render icon()}</span><span class="t">{noOrphan(text)}</span>{#if children}{' '}{@render children()}{/if}{/snippet}

{#if card}
  <Card kind="section" as="p" class="tabblurb boxed {klass}">{@render words()}</Card>
{:else}
  <p class="tabblurb {klass}">{@render words()}</p>
{/if}

<style>
  /* The boxed blurb's element is drawn by the shared Card, so it is reached with a global rule. */
  .tabblurb, :global(.tabblurb.boxed) { margin: var(--space-2) 0 var(--space-4); color: var(--accent); font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; text-wrap: pretty; }
  :global(.tabblurb.boxed) { margin: 0 0 var(--space-3); }
  .t { font-weight: 600; }
  .i { display: inline-block; vertical-align: -3px; margin-right: var(--space-2); line-height: 0; }
  .tabblurb :global(a), .tabblurb :global(button), :global(.tabblurb.boxed a), :global(.tabblurb.boxed button) { padding: 0; font: inherit; color: var(--accent); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
</style>
