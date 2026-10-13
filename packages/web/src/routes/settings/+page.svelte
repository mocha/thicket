<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import ReadingSettings from '$lib/components/settings/ReadingSettings.svelte';
  import AccountSettings from '$lib/components/settings/AccountSettings.svelte';

  /**
   * Settings: one door in the account menu, two tabs, the same row Explore and
   * Admin use. Reading is how thicket looks and reads; Account and data is
   * your email, password, imports, exports, and API tokens. They used to be two
   * pages; /account now lands on the second tab.
   */
  type Tab = 'reading' | 'account';
  /** Which tab is open, kept in the address so Back and a shared link land on it. Reading by default. */
  const tab = $derived<Tab>(page.url.searchParams.get('tab') === 'account' ? 'account' : 'reading');
  const tabs = [{ value: 'reading', label: 'Reading' }, { value: 'account', label: 'Account and data' }];
  function pick(v: string) {
    api.event('settings_tab', { tab: v });
    void goto(v === 'reading' ? '/settings' : `/settings?tab=${v}`, { replaceState: true, noScroll: true, keepFocus: true });
  }
</script>

<svelte:head><title>Settings · thicket</title></svelte:head>

<PageHeader name="Settings" />

<div class="pane">
  <Tabs class="scopes" {tabs} value={tab} onchange={pick} label="Parts of Settings" panel="settings-tab" fill />
</div>
<div id="settings-tab" role="tabpanel" aria-label={tabs.find((t) => t.value === tab)?.label}>
  {#if tab === 'account'}<AccountSettings />{:else}<ReadingSettings />{/if}
</div>

<style>
  /* The same row as Explore's and Admin's, with the same air under it. */
  .pane { margin-bottom: var(--space-2); }
  .pane :global(.scopes) { margin-bottom: var(--space-1); }
</style>
