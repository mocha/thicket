<script lang="ts">
  /**
   * The one "nothing here yet" screen, for someone who follows nothing (THICKET-34):
   * Collections and New posts both open on it, each under its own title. The
   * starter collections to tick, as many as you like, copied with one button
   * pinned at the bottom; under it, the other two ways in, adding a feed or
   * importing. Explore's Collections tab shows the same cards in place of its
   * rows (`bare`: no title, since Explore's own header and caption lead them),
   * and goes back to its rows when `none` says there are no cards to show.
   *
   * Copies that fail are said above the cards, each with its reason, and
   * handed to `oncopied` too: whatever did copy is in, so the page swaps to its
   * usual view and says the failures there.
   */
  import { type ExploreCollection } from '$lib/api';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { copyPacks } from '$lib/firstrun.svelte';
  import StarterPacks from './StarterPacks.svelte';
  import ActionBar from './ActionBar.svelte';
  import CopyFailures from './CopyFailures.svelte';
  import Button from './Button.svelte';
  import Dot from './Dot.svelte';
  import Welcome from './Welcome.svelte';

  let { title = '', sub = '', via, bare = false, none = $bindable(false), oncopied }: { title?: string; sub?: string; via: string; bare?: boolean; none?: boolean; oncopied: (failed: { name: string; why: string }[]) => Promise<unknown> | void } = $props();

  let picked = $state<ExploreCollection[]>([]);
  let available = $state(0);
  let loaded = $state(false);
  /** Told to the page once the answer is in: this site offers no starter collections (or they couldn't be loaded). */
  $effect(() => { none = loaded && available === 0; });
  let copying = $state(false);
  let failed = $state<{ name: string; why: string }[]>([]);

  async function copyPicked() {
    if (copying || !picked.length) return;
    copying = true; failed = [];
    failed = await copyPacks(picked, via);
    picked = [];
    try { await oncopied(failed); } finally { copying = false; }
  }
</script>

{#if failed.length}<div class="failed"><CopyFailures {failed} /></div>{/if}
{#if !bare}<Welcome {title} {sub} />{/if}
<StarterPacks heading="" lede="" bind:picked bind:available bind:loaded />
{#if available}
  <ActionBar>
    <Button variant="primary" onclick={copyPicked} disabled={copying || !picked.length}>
      {copying ? 'Copying…' : picked.length === 1 ? 'Copy 1 collection' : picked.length ? `Copy ${picked.length} collections` : 'Copy collections'}
    </Button>
  </ActionBar>
{/if}
<hr class="split" />
<p class="other"><span>Already know what you want?</span><span class="ways"><Button link onclick={() => openAddFeed({ via })}>+ Add new feed</Button><Dot /><Button link href="/import">Import feeds</Button></span></p>

<style>
  .ways { display: inline-flex; align-items: center; white-space: nowrap; }
  .failed { margin-bottom: var(--space-4); }
  /* The same line as under the page's heading, as wide as the cards, setting the other ways in apart from the button. */
  .split { width: 100%; margin: var(--space-4) auto 0; border: 0; border-top: 1px solid var(--line); }
  /* The other two ways in, under the Copy button: a gray lead-in, then the two
     links. The links stay together, so a narrow screen puts them on the line
     under the question rather than splitting them. */
  .other { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; margin: var(--space-4) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
