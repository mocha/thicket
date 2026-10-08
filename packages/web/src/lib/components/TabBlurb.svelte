<script lang="ts">
  /**
   * One line under a row of tabs saying what the chosen tab shows: a small
   * icon and a short sentence, centered, in the accent color. It sits in the
   * same spot on every tab, so the tabs pick the view and this says what it
   * is. Explore uses it for what each search covers; a profile uses it to tell
   * its owner who can see the open tab.
   *
   * `icon` is drawn at 16px. Anything after the sentence (a "Change" link)
   * goes in `children`. `inset`: it leads a card, as on Explore's browse
   * lists, so it takes the card's padding instead of the page's margins.
   */
  import type { Snippet } from 'svelte';
  import { noOrphan } from '$lib/orphans';

  let { text, icon, children, inset = false, class: klass = '' }: { text: string; icon: Snippet; children?: Snippet; inset?: boolean; class?: string } = $props();
</script>

<p class="tabblurb {klass}" class:inset><span class="i">{@render icon()}</span><span class="t">{noOrphan(text)}</span>{#if children}{' '}{@render children()}{/if}</p>

<style>
  .tabblurb { margin: var(--space-2) 0 var(--space-4); color: var(--accent); font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; text-wrap: pretty; }
  .inset { margin: 0; padding: var(--space-5) var(--space-3) var(--space-2); }
  .t { font-weight: 600; }
  .i { display: inline-block; vertical-align: -3px; margin-right: var(--space-2); line-height: 0; }
  .tabblurb :global(a) { color: var(--accent); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
</style>
