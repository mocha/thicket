<script lang="ts">
  /**
   * Who sees what on your profile, all in one place (issue #232): the page
   * itself, then each section on it. Every choice saves the moment it's
   * picked. While the page is hidden there is nothing for a section to share,
   * so only the page's own switch shows. Only the owner ever sees this card;
   * each tab then says its own setting in a line under the tabs.
   */
  import { api, authApi, type ShareLevel } from '$lib/api';
  import { session, setMe } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import ChoiceGroup from './ChoiceGroup.svelte';
  import SectionAudience from './SectionAudience.svelte';

  let { id }: { id?: string } = $props();

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
  <!-- No heading: the card's rows name themselves, and it's named for screen readers. -->
  <section {id} aria-label="Visibility">
    <div class="card">
      <div class="row">
        <div class="label">
          <span class="name">This page</span>
          <p class="hint">{su.profileVisibility === 'private' ? 'Hidden so only you can see this page. You still count toward feed follower numbers, but no one can tell it’s you.' : 'Anyone can open it and see the parts you share below.'}</p>
        </div>
        <ChoiceGroup
          options={PAGE}
          value={su.profileVisibility}
          label="Who can see this page"
          size="sm"
          onchange={(v) => save({ profileVisibility: v as 'public' | 'private' }, v === 'public' ? 'Profile is public' : 'Profile is private')}
        />
      </div>
      {#if su.profileVisibility !== 'private'}
        {#each SECTIONS as s (s.key)}
          <div class="row">
            <div class="label"><span class="name">{s.label}</span></div>
            <SectionAudience level={su[s.key]} label={s.what} onchange={(l) => save({ [s.key]: l }, `${s.toast}: ${AUD[l]}`)} />
          </div>
        {/each}
      {/if}
    </div>
  </section>
{/if}

<style>
  section { margin-bottom: var(--space-5); scroll-margin-top: var(--space-4); }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  /* The name on the left, its choice on the right; on a narrow screen the choice drops under the name. */
  .row { display: flex; align-items: center; gap: var(--space-2) var(--space-4); flex-wrap: wrap; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .row:first-child { border-top: 0; }
  .label { flex: 1; min-width: 12ch; }
  .name { font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  /* 2px is an optical nudge under the name, not a spacing step. */
  .hint { margin: 2px 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  /* At least 320px so the options aren't cramped, wider when larger text needs it, never wider than the row. */
  .row :global(.cg) { flex: none; width: fit-content; min-width: min(320px, 100%); max-width: 100%; }
</style>
