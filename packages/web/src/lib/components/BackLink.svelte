<script lang="ts">
  /**
   * The way out of a page, by name, with an arrow before it: "‹ Explore".
   * It takes the size of the text around it, so it heads a Breadcrumb as
   * readily as it sits small above a title.
   *
   * With `stepBack`, a plain click goes back one step in history instead of
   * following the link, for when the page named is the one just behind this
   * one: it comes back as it was left, and Back afterwards doesn't return here.
   * A click that opens a new tab or window still follows the link.
   *
   * With no `href` it is just "Back": a button that steps back, for the
   * installed app's own Back, where the page behind has no name we know.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { appBack } from '$lib/wayback.svelte';

  interface Props {
    href?: string;
    label?: string;
    stepBack?: boolean;
  }

  let { href, label = 'Back', stepBack = false }: Props = $props();

  /** A page's own way back: the installed app's Back at the top of the page makes way for it. */
  $effect(() => {
    if (!href) return;
    untrack(() => appBack.owned++);
    return () => untrack(() => appBack.owned--);
  });

  function onclick(e: MouseEvent) {
    if (!stepBack || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    history.back();
  }
</script>

{#snippet inner()}<Icon name="back" size={16} stroke={2.5} class="arrow" /><span class="name">{label}</span>{/snippet}
{#if href}<a class="back tap" {href} {onclick}>{@render inner()}</a>
{:else}<button type="button" class="back tap" onclick={() => history.back()}>{@render inner()}</button>{/if}

<style>
  .back { display: inline-flex; font: inherit; background: none; border: 0; padding: 0; cursor: pointer; align-items: center; gap: 0.15em; min-width: 0; max-width: 100%; font-weight: 600; color: var(--accent); text-decoration: none; }
  .back:hover { text-decoration: underline; text-underline-offset: 0.2em; }
  /* A long name is cut short with an ellipsis rather than pushing the page sideways. */
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The arrow scales with the words beside it, and sits a hair left so the name lines up with the text below. */
  .back :global(.arrow) { flex: none; width: 1em; height: 1em; margin-left: -0.2em; }
</style>
