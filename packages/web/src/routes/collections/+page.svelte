<script lang="ts">
  /**
   * Your collections, on their own: the screen the left menu's Collections
   * opens. The same list as your profile's Collections tab, with a filter box
   * (issue #178), so it can't drift from what the profile shows.
   *
   * With no collections, this is where a new person starts (issue #289): the
   * starter packs, picked as many as you like and copied with one button
   * pinned at the bottom, then the other two ways in. Once something is
   * copied, the page shows the usual list; the welcome comes back only if you
   * delete every collection.
   */
  import { session } from '$lib/session.svelte';
  import { api, profilesApi, profileHref, type ExploreCollection, type ProfileCollection } from '$lib/api';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { loadCollections } from '$lib/collections.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import CollectionTree from '$lib/components/CollectionTree.svelte';
  import StarterPacks from '$lib/components/StarterPacks.svelte';
  import ActionBar from '$lib/components/ActionBar.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dot from '$lib/components/Dot.svelte';
  import Welcome from '$lib/components/Welcome.svelte';

  const me = $derived(session.user);
  let cols = $state<ProfileCollection[] | null>(null);
  let error = $state<string | null>(null);
  let loadedFor: string | undefined;
  $effect(() => {
    const h = me?.handle;
    if (!h || loadedFor === h) return;
    loadedFor = h;
    void load(h);
  });
  async function load(h: string) {
    try {
      const p = await profilesApi.get(h);
      if (loadedFor === h) cols = p.private ? [] : (p.collections ?? []);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  /** The welcome's starter packs: the ones ticked, and how many there are to tick. */
  let picked = $state<ExploreCollection[]>([]);
  let available = $state(0);
  let copying = $state(false);
  /** Packs that didn't copy, each with the reason, said above whatever did. */
  let failed = $state<{ name: string; why: string }[]>([]);

  /** One at a time, so each copy's name is checked against the ones before it. A failure doesn't stop the rest. */
  async function copyPicked() {
    if (copying || !picked.length || !me) return;
    copying = true; failed = [];
    for (const c of picked) {
      try {
        await profilesApi.copyCollection(c.handle, c.slug);
        api.event('starter_pack_copied', { collectionId: c.id, via: 'collections_welcome' });
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        console.error(`[starter packs] copying @${c.handle}/${c.slug} failed:`, e);
        api.event('starter_pack_copy_failed', { collectionId: c.id, reason: why });
        failed = [...failed, { name: c.name, why }];
      }
    }
    picked = [];
    try {
      await Promise.all([load(me.handle), loadCollections(true)]);
    } finally {
      copying = false;
    }
  }
  const shared = $derived(me?.profileVisibility === 'public' && me.collectionsVisibility !== 'private' ? me.collectionsVisibility : null);
</script>

<svelte:head><title>Collections · thicket</title></svelte:head>

{#if me && cols && !cols.length && !error}
  <!-- No collections: the welcome, laid out like New posts' own. -->
  {#if failed.length}{@render failures()}{/if}
  <Welcome title="Collections" sub="If you want an easy way to get started, copy one or more of these Collections." />
  <StarterPacks heading="" lede="" bind:picked bind:available />
  <p class="other"><span>Already know what you want?</span><span class="ways"><Button link onclick={() => openAddFeed({ via: 'collections_welcome' })}>+ Add new feed</Button><Dot /><Button link href="/import">Import feeds</Button></span></p>
  {#if available}
    <ActionBar>
      <Button variant="primary" onclick={copyPicked} disabled={copying || !picked.length}>
        {copying ? 'Copying…' : picked.length === 1 ? 'Copy 1 collection' : picked.length ? `Copy ${picked.length} collections` : 'Copy collections'}
      </Button>
    </ActionBar>
  {/if}
{:else if me}
  <PageHeader>
    {#snippet title()}<h1 class="pagetitle">Collections</h1>{/snippet}
    {#snippet description()}Your feeds, grouped your way. {#if !shared}Only you can see them.{:else}Shown on <a href="{profileHref(me.handle)}/collections">your profile</a>{shared === 'friends' ? ' to the people you follow' : ''}.{/if}{/snippet}
    {#snippet actions()}<AddFeedButton via="collections" bottomBarOnly />{/snippet}
  </PageHeader>
  {#if error}
    <p class="status">{error}</p>
  {:else if cols === null}
    <p class="status">Loading…</p>
  {:else}
    {#if failed.length}{@render failures()}{/if}
    <CollectionTree collections={cols} handle={me.handle} isMe filterable creatable />
  {/if}
{/if}

<!-- Packs that didn't copy, each with why, above whatever did. -->
{#snippet failures()}
  <div class="failed">
    <Banner tone="error" title={failed.length === 1 ? `Couldn’t copy ${failed[0].name}` : `Couldn’t copy ${failed.length} collections`}>
      {#if failed.length === 1}{failed[0].why}{:else}{#each failed as f (f.name)}<span class="line">{f.name}: {f.why}</span>{/each}{/if}
    </Banner>
  </div>
{/snippet}

<style>
  /* The page's own title, in the place a page title sits everywhere else. */
  .pagetitle { display: flex; align-items: center; gap: var(--space-2); font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.15; margin: 0; }
  .ways { display: inline-flex; align-items: center; white-space: nowrap; }
  .failed { margin-bottom: var(--space-4); }
  .line { display: block; }
  /* The other two ways in, after the packs: a gray lead-in, then the two
     links. The links stay together, so a narrow screen puts them on the line
     under the question rather than splitting them. */
  .other { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; margin: var(--space-6) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-2) 0; margin: 0; }
</style>
