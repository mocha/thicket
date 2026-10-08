<script lang="ts">
  /**
   * Who sees what on your profile, all in one place (issue #232): the page
   * itself, then each section on it. Every choice saves the moment it's
   * picked. While the page is hidden there is nothing for a section to share,
   * so only the page's own switch shows. Only the owner ever sees it: the
   * Visibility button in the profile's header opens it, as does Change on the
   * line at the top of each tab, which says that tab's own setting.
   */
  import Sheet from './Sheet.svelte';
  import { api, authApi, type ShareLevel } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import ChoiceGroup from './ChoiceGroup.svelte';
  import SectionAudience from './SectionAudience.svelte';

  let { onclose }: { onclose: () => void } = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  $effect(() => { dialog?.showModal(); });

  const su = $derived(session.user);
  const AUD: Record<ShareLevel, string> = { private: 'only you', friends: 'people you follow', public: 'anyone' };
  const PAGE = [
    { value: 'public', label: 'Anyone' },
    { value: 'private', label: 'Only me' }
  ];
  type Section = 'collectionsVisibility' | 'bookmarksVisibility' | 'notesVisibility' | 'activityVisibility';
  const SECTIONS: { key: Section; label: string; what: string; toast: string }[] = [
    { key: 'collectionsVisibility', label: 'Collections', what: 'your collections', toast: 'Collections' },
    { key: 'bookmarksVisibility', label: 'Bookmarks', what: 'your bookmarks', toast: 'Bookmarks' },
    { key: 'notesVisibility', label: 'Notes', what: 'your notes', toast: 'Notes' },
    { key: 'activityVisibility', label: 'Recent activity', what: 'your recent activity', toast: 'Recent activity' }
  ];

  async function save(patch: Parameters<typeof authApi.update>[0], label: string) {
    try {
      setMe(await authApi.update(patch));
      api.event('settings_changed', { keys: Object.keys(patch) });
      showToast(label);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }
</script>

{#if su}
  <Sheet title="Visibility" bind:dialog {onclose}>
    <p class="lede">Choose who sees each part of your profile.</p>
    <div class="rows">
      <div class="row">
        <span class="name">Profile page</span>
        <p class="hint">{su.profileVisibility === 'private' ? 'Only you can open your profile. You still count toward feed follower numbers, but no one can tell it’s you.' : 'Anyone can open your profile and see the parts you share below.'}</p>
        <ChoiceGroup
          options={PAGE}
          value={su.profileVisibility}
          label="Who can see your profile page"
          size="sm"
          fill
          onchange={(v) => save({ profileVisibility: v as 'public' | 'private' }, v === 'public' ? 'Profile is public' : 'Profile is private')}
        />
      </div>
      {#if su.profileVisibility !== 'private'}
        {#each SECTIONS as s (s.key)}
          <div class="row">
            <span class="name">{s.label}</span>
            <SectionAudience level={su[s.key]} label={s.what} onchange={(l) => save({ [s.key]: l }, `${s.toast}: ${AUD[l]}`)} />
          </div>
        {/each}
      {/if}
    </div>
  </Sheet>
{/if}

<style>
  /* Each setting's name above its choice, one setting per row, the rows split by a hairline. */
  .row { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-3) 0; border-top: 1px solid var(--line); }
  .row:last-child { padding-bottom: 0; }
  /* Under the title, as on Add a feed, so the title and the first setting don't run together. */
  .lede { color: var(--text-2); margin: calc(-1 * var(--space-2)) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .name { font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  .hint { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  .row :global(.cg) { width: 100%; }
</style>
