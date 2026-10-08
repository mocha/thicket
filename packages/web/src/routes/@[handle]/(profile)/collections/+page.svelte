<script lang="ts">
  /** A profile's Collections tab, at /@handle/collections: every collection they share, as a tree. */
  import { getProfileContext } from '$lib/profile.svelte';
  import CollectionTree from '$lib/components/CollectionTree.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';

  const ctx = getProfileContext();
  const profile = $derived(ctx.profile);
  let filter = $state('');
</script>

{@render ctx.tabLine()}

{#if profile.collections}
  {#if profile.collections.length > 1}
    <!-- The filter sits on its own, just above the list it narrows, as on the Bookmarks tab. -->
    <div class="filter">
      <Field label="Filter collections" hideLabel>
        {#snippet children({ id })}
          <Input {id} variant="search" bind:value={filter} placeholder="Filter collections" maxlength="60" autocomplete="off"
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') filter = ''; }} />
        {/snippet}
      </Field>
    </div>
  {/if}
  <CollectionTree collections={profile.collections} handle={profile.handle} isMe={profile.isMe} {filter} />
{/if}

<style>
  .filter { margin: 0 0 var(--space-3); }
</style>
