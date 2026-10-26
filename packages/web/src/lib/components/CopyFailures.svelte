<script lang="ts">
  /** Starter packs that didn't copy, each with why, said above whatever did (lib/firstrun.svelte.ts copyPacks). */
  import Banner from './Banner.svelte';
  let { failed }: { failed: { name: string; why: string }[] } = $props();
</script>

<Banner tone="error" title={failed.length === 1 ? `Couldn’t copy ${failed[0].name}` : `Couldn’t copy ${failed.length} collections`}>
  {#if failed.length === 1}{failed[0].why}{:else}{#each failed as f (f.name)}<span class="line">{f.name}: {f.why}</span>{/each}{/if}
</Banner>

<style>
  .line { display: block; }
</style>
