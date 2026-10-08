<script lang="ts">
  /**
   * One line under a row of tabs saying what the chosen tab shows: a small
   * icon and a short sentence, centered, in the accent color. It sits in the
   * same spot on every tab, so the tabs pick the view and this says what it
   * is. Explore uses it for what each search covers; a profile uses it to tell
   * its owner who can see the open tab.
   *
   * `icon` is drawn at 16px. Anything after the sentence (a "Change" link)
   * goes in `children`.
   */
  import type { Snippet } from 'svelte';
  import { noOrphan } from '$lib/orphans';

  let { text, icon, children, class: klass = '' }: { text: string; icon: Snippet; children?: Snippet; class?: string } = $props();
</script>

<p class="tabblurb {klass}"><span class="i">{@render icon()}</span><span class="t">{noOrphan(text)}</span>{#if children}{' '}{@render children()}{/if}</p>

<style>
  .tabblurb { margin: var(--space-2) 0 var(--space-4); color: var(--accent); font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; text-wrap: pretty; }
  .t { font-weight: 600; }
  .i { display: inline-block; vertical-align: -3px; margin-right: var(--space-2); line-height: 0; }
  .tabblurb :global(a) { color: var(--accent); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
</style>
