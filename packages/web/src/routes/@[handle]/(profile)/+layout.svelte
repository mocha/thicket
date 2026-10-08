<script lang="ts">
  /**
   * A person's profile (issue #232): one header on every tab, then a row of
   * tabs, each at its own address so a shared link opens that tab and Back
   * returns to the last one. Overview (/@handle) previews each section; the
   * others show one section in full. A section the visitor may not see, or
   * one with nothing in it, has no tab, and its address falls back to
   * Overview.
   *
   * The owner gets a line at the top of each tab saying who can see it, with
   * a Change link that opens the Visibility Sheet, where every setting lives
   * (the header's Visibility button opens it too). It sits on
   * a card of its own at the top of each tab, apart from the tab's items.
   */
  import type { Snippet } from 'svelte';
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
  import VisibilitySheet from '$lib/components/VisibilitySheet.svelte';
  import { SEES } from '$lib/visibility';

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
  setProfileContext({ get profile() { return loaded!; } });

  /** The Visibility Sheet: the owner's settings for who sees what. */
  let visibilityOpen = $state(false);
  function openVisibility() {
    api.event('profile_visibility_opened');
    visibilityOpen = true;
  }

  const tab = $derived(tabOf(page.url.pathname, handle));
  const shown = $derived(loaded ? shownTabs(loaded) : new Set<ProfileTab>());
  // Words only, like Explore's tabs: the counts are on Overview, in each section's "All …" link.
  const tabs = $derived(PROFILE_TABS.filter((t) => shown.has(t.value)));
  const label = $derived(PROFILE_TABS.find((t) => t.value === tab)?.label ?? '');

  // An address for a tab this visitor can't see lands on Overview instead, leaving no trace of the section.
  $effect(() => {
    if (loaded && !shown.has(tab)) void goto(tabHref(handle, 'overview'), { replaceState: true });
  });

  // #visibility (the note box's Change link) opens the Visibility Sheet once the profile is drawn, whether you
  // came from another page or from a tab of this one. Older links went to #bookmarks: the owner was after the
  // notes setting, which is now in that Sheet; a visitor was after the bookmarks, which now have their own tab.
  $effect(() => {
    const hash = page.url.hash;
    if (!loaded || (hash !== '#visibility' && hash !== '#bookmarks')) return;
    if (loaded.isMe) {
      visibilityOpen = true;
      void goto(page.url.pathname, { replaceState: true, noScroll: true, keepFocus: true });
    } else if (hash === '#bookmarks') void goto(tabHref(handle, 'bookmarks'), { replaceState: true });
  });

  function pick(v: string) {
    api.event('profile_tab', { tab: v });
    void goto(tabHref(handle, v as ProfileTab), { noScroll: true, keepFocus: true });
  }

  /** For the owner: who can see the open tab, said in a sentence, with the eye crossed out when only they can. */
  const blurb = $derived.by(() => {
    const su = session.user;
    if (!loaded?.isMe || !su) return null;
    const line = (text: string, level: ShareLevel) => ({ text, hidden: level === 'private' });
    if (su.profileVisibility === 'private') return line(tab === 'overview' ? 'Only you can see your profile.' : 'Your profile is hidden, so only you can see this.', 'private');
    if (tab === 'overview') return line('Anyone can see your profile.', 'public');
    if (tab === 'collections') return line(`${SEES[su.collectionsVisibility]} your collections.`, su.collectionsVisibility);
    if (tab === 'activity') return line(`${SEES[su.activityVisibility]} your recent activity.`, su.activityVisibility);
    const b = su.bookmarksVisibility, n = su.notesVisibility;
    return b === n ? line(`${SEES[b]} your bookmarks and notes.`, b) : { text: `${SEES[b]} your bookmarks. ${SEES[n]} your notes.`, hidden: false };
  });
</script>

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
  <ProfileHeader profile={loaded} onvisibility={openVisibility} />
  {#if visibilityOpen && loaded.isMe}
    <VisibilitySheet onclose={() => (visibilityOpen = false)} />
  {/if}

  {#if tabs.length > 1}
    <!-- The same row as Explore's: the tabs share it evenly, with the same air under it. -->
    <div class="pane">
      <Tabs class="scopes" {tabs} value={tab} onchange={pick} label="Parts of this profile" panel="profile-tab" fill />
    </div>
  {/if}
  <div class="panel" id="profile-tab" role={tabs.length > 1 ? 'tabpanel' : undefined} aria-label={tabs.length > 1 ? label : undefined}>
    {#if shown.has(tab)}
      {#if blurb}
        <!-- Who can see this tab, on a card of its own above the tab's items. -->
        <TabBlurb text={blurb.text} card>
          {#snippet icon()}<Icon name={blurb.hidden ? 'eye-off' : 'eye'} size={16} />{/snippet}
          <button type="button" aria-haspopup="dialog" onclick={openVisibility}>Change</button>
        </TabBlurb>
      {/if}
      {@render children()}
    {/if}
  </div>

  {#if !session.user}
    <p class="join">Want your own? <a href="/signup?next={encodeURIComponent(page.url.pathname)}">Sign up</a> and start following feeds.</p>
  {/if}
{/if}

<style>
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
