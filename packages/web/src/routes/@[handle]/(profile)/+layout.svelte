<script lang="ts">
  /**
   * A person's profile (issue #232): one header on every tab, then a row of
   * tabs, each at its own address so a shared link opens that tab and Back
   * returns to the last one. Overview (/@handle) previews each section; the
   * others show one section in full. A section the visitor may not see, or
   * one with nothing in it, has no tab, and its address falls back to
   * Overview.
   *
   * The owner gets a line under each tab saying who can see it, with a link
   * to the Visibility card on Overview where every setting lives. Each tab
   * places it, as Explore does: leading the tab's card when there is one card,
   * above the cards when there are several.
   */
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, profilesApi, type Profile, type ShareLevel } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { PROFILE_TABS, setProfileContext, shownTabs, tabHref, tabOf, type ProfileTab } from '$lib/profile.svelte';
  import Monogram from '$lib/components/Monogram.svelte';
  import ProfileHeader from '$lib/components/ProfileHeader.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import TabBlurb from '$lib/components/TabBlurb.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let { children }: { children: Snippet } = $props();

  const handle = $derived(page.params.handle ?? '');
  let profile = $state<Profile | null>(null);
  let error = $state<string | null>(null);
  let loadedHandle: string | undefined;
  $effect(() => {
    const h = handle;
    if (loadedHandle === h) return;
    loadedHandle = h;
    profile = null; error = null;
    api.event('profile_view', { handle: h });
    profilesApi.get(h)
      .then((p) => { if (loadedHandle === h) profile = p; })
      .catch((e) => { if (loadedHandle === h) error = e instanceof Error ? e.message : String(e); });
  });
  const loaded = $derived(profile && !profile.private ? profile : null);
  // The tabs only draw once the profile is here, so they can always count on it.
  setProfileContext({ get profile() { return loaded!; }, tabLine });

  const tab = $derived(tabOf(page.url.pathname, handle));
  const shown = $derived(loaded ? shownTabs(loaded) : new Set<ProfileTab>());
  // Words only, like Explore's tabs: the counts are on Overview, in each section's "All …" link.
  const tabs = $derived(PROFILE_TABS.filter((t) => shown.has(t.value)));
  const label = $derived(PROFILE_TABS.find((t) => t.value === tab)?.label ?? '');

  // An address for a tab this visitor can't see lands on Overview instead, leaving no trace of the section.
  $effect(() => {
    if (loaded && !shown.has(tab)) void goto(tabHref(handle, 'overview'), { replaceState: true });
  });

  // A link to a spot on the page (#visibility, from the note box) can only land once the profile is drawn. Older
  // links went to #bookmarks: the owner was after the notes setting, which is now in the Visibility card; a
  // visitor was after the bookmarks, which now have their own tab.
  let jumpedFor: string | undefined;
  $effect(() => {
    if (!loaded || jumpedFor === loaded.handle) return;
    jumpedFor = loaded.handle;
    const hash = location.hash;
    const land = (id: string) => tick().then(() => document.getElementById(id)?.scrollIntoView());
    if (hash === '#bookmarks') {
      if (loaded.isMe) void goto(`${tabHref(handle, 'overview')}#visibility`, { replaceState: true }).then(() => land('visibility'));
      else void goto(tabHref(handle, 'bookmarks'), { replaceState: true });
    } else if (hash) void land(hash.slice(1));
  });

  function pick(v: string) {
    api.event('profile_tab', { tab: v });
    void goto(tabHref(handle, v as ProfileTab), { noScroll: true, keepFocus: true });
  }

  /** For the owner: who can see the open tab, said in a sentence. */
  const WHO: Record<ShareLevel, string> = { private: 'Only you', friends: 'People you follow', public: 'Anyone' };
  const blurb = $derived.by(() => {
    const su = session.user;
    if (!loaded?.isMe || !su || tab === 'overview') return null;
    if (su.profileVisibility === 'private') return { text: 'Your profile is hidden, so only you can see this.', hidden: true };
    if (tab === 'collections') return { text: `${WHO[su.collectionsVisibility]} can see your collections.`, hidden: su.collectionsVisibility === 'private' };
    if (tab === 'activity') return { text: `${WHO[su.activityVisibility]} can see your recent activity.`, hidden: su.activityVisibility === 'private' };
    const b = su.bookmarksVisibility, n = su.notesVisibility;
    return {
      text: b === n ? `${WHO[b]} can see your bookmarks and notes.` : `${WHO[b]} can see your bookmarks. ${WHO[n]} can see your notes.`,
      hidden: b === 'private' && n === 'private'
    };
  });
</script>

{#snippet tabLine(inset: boolean)}
  {#if blurb}
    <TabBlurb text={blurb.text} {inset}>
      {#snippet icon()}<Icon name={blurb.hidden ? 'eye-off' : 'eye'} size={16} />{/snippet}
      <a href="{tabHref(handle, 'overview')}#visibility">Change</a>
    </TabBlurb>
  {/if}
{/snippet}

<svelte:head><title>{tab === 'overview' ? '' : `${label} · `}@{handle} · thicket</title></svelte:head>

{#if error}
  <div class="empty"><h1>@{handle}</h1><p>{error === 'not found' ? 'No one here by that handle.' : error}</p></div>
{:else if !profile}
  <p class="status">Loading…</p>
{:else if profile.private}
  <div class="empty">
    <Monogram name={profile.handle} size={64} />
    <h1>@{profile.handle}</h1>
    <p>This profile is private.</p>
  </div>
{:else if loaded}
  {#if loaded.isMe}
    <p class="ownerbar">This is your <strong>public profile</strong>. Depending on your settings, it's what everyone else sees.</p>
  {/if}
  <ProfileHeader profile={loaded} />

  {#if tabs.length > 1}
    <!-- The same row as Explore's: the tabs share it evenly, with the same air under it. -->
    <div class="pane">
      <Tabs class="scopes" {tabs} value={tab} onchange={pick} label="Parts of this profile" panel="profile-tab" fill />
    </div>
  {/if}
  <div class="panel" id="profile-tab" role={tabs.length > 1 ? 'tabpanel' : undefined} aria-label={tabs.length > 1 ? label : undefined}>
    {#if shown.has(tab)}{@render children()}{/if}
  </div>

  {#if !session.user}
    <p class="join">Want your own? <a href="/signup?next={encodeURIComponent(page.url.pathname)}">Sign up</a> and start following feeds.</p>
  {/if}
{/if}

<style>
  /* Owner only: a muted one-line reminder in a soft box at the very top of the page. */
  .ownerbar { margin: 0 0 var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); background: var(--surface-2); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); text-align: center; }
  /* Explore's spacing under its tabs, exactly. */
  .pane { margin-bottom: var(--space-2); }
  .pane :global(.scopes) { margin-bottom: var(--space-1); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-2) 0; margin: 0; }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-4)) var(--space-5); color: var(--text-2); display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
  .empty p { margin: 0; }
  .empty h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; line-height: 1.15; color: var(--text); }
  .join { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); margin-top: var(--space-6); }
  .join a { color: var(--accent); font-weight: 600; }
</style>
