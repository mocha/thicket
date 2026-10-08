<script lang="ts">
  /** A profile's Collections tab, at /@handle/collections: every collection they share, as a tree. */
  import { getProfileContext } from '$lib/profile.svelte';
  import CollectionTree from '$lib/components/CollectionTree.svelte';

  const ctx = getProfileContext();
  const profile = $derived(ctx.profile);
</script>

{#if profile.collections}
  <CollectionTree collections={profile.collections} handle={profile.handle} isMe={profile.isMe} filterable />
{/if}
