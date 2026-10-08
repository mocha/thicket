<script lang="ts">
  /**
   * Your collections, on their own: the screen the left menu's Collections
   * opens. The same list as your profile's Collections tab, with a filter box
   * (issue #178), so it can't drift from what the profile shows.
   */
  import { session } from '$lib/session.svelte';
  import { profilesApi, profileHref, type ProfileCollection } from '$lib/api';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import CollectionTree from '$lib/components/CollectionTree.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';

  const me = $derived(session.user);
  let cols = $state<ProfileCollection[] | null>(null);
  let error = $state<string | null>(null);
  let loadedFor: string | undefined;
  $effect(() => {
    const h = me?.handle;
    if (!h || loadedFor === h) return;
    loadedFor = h;
    profilesApi.get(h)
      .then((p) => { if (loadedFor === h) cols = p.private ? [] : (p.collections ?? []); })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });
  const shared = $derived(me?.profileVisibility === 'public' && me.collectionsVisibility !== 'private' ? me.collectionsVisibility : null);
  let filter = $state('');
</script>

<svelte:head><title>Collections · thicket</title></svelte:head>

{#if me}
  <PageHeader>
    {#snippet title()}<h1 class="pagetitle">Collections {#if cols}<Badge>{cols.length}</Badge>{/if}</h1>{/snippet}
    {#snippet description()}Your feeds, grouped your way. {#if !shared}Only you can see them.{:else}Shown on <a href="{profileHref(me.handle)}/collections">your profile</a>{shared === 'friends' ? ' to the people you follow' : ''}.{/if}{/snippet}
    {#snippet actions()}<AddFeedButton via="collections" bottomBarOnly />{/snippet}
  </PageHeader>
  {#if error}
    <p class="status">{error}</p>
  {:else if cols === null}
    <p class="status">Loading…</p>
  {:else}
    <div class="filter">
      <Field label="Filter collections" hideLabel>
        {#snippet children({ id })}
          <Input {id} variant="search" bind:value={filter} placeholder="Filter collections" maxlength="60" autocomplete="off"
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') filter = ''; }} />
        {/snippet}
      </Field>
    </div>
    <CollectionTree collections={cols} handle={me.handle} isMe {filter} via="collections" />
  {/if}
{/if}

<style>
  /* The page's own title, in the place a page title sits everywhere else. */
  .pagetitle { display: flex; align-items: center; gap: var(--space-2); font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.15; margin: 0; }
  /* The filter sits just above the card it narrows, like the Bookmarks search. */
  .filter { margin: 0 0 var(--space-3); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-2) 0; margin: 0; }
</style>
