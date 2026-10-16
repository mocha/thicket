<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Dot from '$lib/components/Dot.svelte';
  /**
   * Admin: the accounts, invite links, and the site-wide settings, for
   * the site's admins. Personal settings stay on Settings; this page
   * is about everyone else.
   *
   * Every setting is its own section card, built like the Reading tab of Settings. Each
   * change shows at once; if saving fails, the card says why and the control
   * goes back to what's saved.
   *
   * Accounts are the shared Person row, with their pills and one Manage button
   * at the right. Manage opens a Sheet with that account's admin switch,
   * password reset, and Delete account. Anything that can't be undone asks
   * first in a Sheet of its own.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, adminApi, profilesApi, collectionHref, type ExploreCollection, type AdminUser, type InstanceStatus, type Invite, type SignupPolicy } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { longAgo, relativeTime } from '$lib/time';
  import { plural } from '$lib/words';
  import { showToast } from '$lib/toast.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Button from '$lib/components/Button.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import CollectionRow from '$lib/components/CollectionRow.svelte';
  import EmptyNote from '$lib/components/EmptyNote.svelte';
  import Field from '$lib/components/Field.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import PersonRow from '$lib/components/PersonRow.svelte';
  import SecretValue from '$lib/components/SecretValue.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import AdminFeedList from '$lib/components/admin/AdminFeedList.svelte';

  /** Which tab is open, kept in the address so Back and a shared link land on it. Accounts by default. */
  type Tab = 'accounts' | 'feeds' | 'invites' | 'settings';
  const tab = $derived<Tab>(((t) => (t === 'invites' || t === 'settings' || t === 'feeds' ? t : 'accounts'))(page.url.searchParams.get('tab')));
  function pick(v: string) {
    api.event('admin_tab', { tab: v });
    void goto(v === 'accounts' ? '/admin' : `/admin?tab=${v}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
  /** "Aug 12", or "2 hours ago" while it's recent enough to say so. */
  const when = (iso: string) => { const r = relativeTime(iso); return /^\d+[mhd]$|^just now$/.test(r) ? longAgo(iso) : r; };

  const me = $derived(session.user);
  /** How many feeds the index holds, for the Feeds tab's count. */
  let feedTotal = $state<number | undefined>(undefined);
  let instance = $state<(InstanceStatus & { signupsStored: SignupPolicy | null }) | null>(null);
  let loadError = $state<string | null>(null);
  /** What failed to save, by card, said on that card. */
  let errors = $state<Record<'signups' | 'visitors' | 'name' | 'starter' | 'invites' | 'manage', string | null>>({ signups: null, visitors: null, name: null, starter: null, invites: null, manage: null });

  let name = $state('');
  let savingName = $state(false);
  let editingName = $state(false);
  let invites = $state<Invite[]>([]);
  let inviteNote = $state('');
  let minting = $state(false);
  // Accounts come a page at a time, newest first, narrowed by the search box.
  let users = $state<AdminUser[]>([]);
  let total = $state(0);
  let matched = $state(0);
  let next = $state<string | null>(null);
  let query = $state('');
  let searched = $state('');
  let searching = $state(false);
  let more = $state(false);
  let accountsError = $state<string | null>(null);
  /** Only the latest search's answer counts, so a slow early one can't replace a later one. */
  let asked = 0;
  async function findAccounts(q: string) {
    const ask = ++asked;
    searching = true; accountsError = null;
    try {
      const r = await adminApi.users({ q });
      if (ask !== asked) return;
      users = r.users; next = r.next; total = r.total ?? 0; matched = r.matched ?? 0; searched = q;
    } catch (e) {
      if (ask === asked) accountsError = say(e);
    } finally {
      if (ask === asked) searching = false;
    }
  }
  let typing: ReturnType<typeof setTimeout> | undefined;
  function onSearch() {
    clearTimeout(typing);
    typing = setTimeout(() => void findAccounts(query.trim()), 250);
  }
  async function showMore() {
    if (!next || more || searching) return;
    more = true; accountsError = null;
    const ask = asked;
    try {
      const r = await adminApi.users({ q: searched, before: next });
      if (ask !== asked) return;
      users = [...users, ...r.users]; next = r.next;
    } catch (e) {
      accountsError = say(e);
    } finally {
      more = false;
    }
  }
  /** Starter packs: the saved account, the box while choosing one, and what new people are offered as a result. */
  let starterSaved = $state('');
  let starter = $state('');
  let changingStarter = $state(false);
  /** Which kind of starter packs is chosen. "account" can be picked before one is saved, while the box is open. */
  let starterPick = $state<'default' | 'account'>('default');
  /** An account shown by its handle alone, when its name and picture aren't to hand (or it's private). */
  const bare = (handle: string) => ({ handle, displayName: null as string | null, bio: null, avatarUpdatedAt: null as string | null });
  let starterPerson = $state<ReturnType<typeof bare> | null>(null);
  let offered = $state<ExploreCollection[]>([]);
  /** Whose collections new people actually get: null when it's the default set, even with an account saved (it was deleted or made private since). */
  let offeredFrom = $state<string | null>(null);
  async function loadStarterPerson(handle: string) {
    starterPerson = null;
    if (!handle) return;
    try {
      const p = await profilesApi.get(handle);
      starterPerson = p.private ? bare(handle) : { ...bare(p.handle), displayName: p.displayName, avatarUpdatedAt: p.avatarUpdatedAt };
    } catch {
      starterPerson = bare(handle);
    }
  }
  let savingStarter = $state(false);

  async function load() {
    try {
      const [s, i, u, f, fc] = await Promise.all([adminApi.settings(), adminApi.invites(), adminApi.users(), adminApi.starter(), adminApi.feeds({ per: 1 }).catch(() => null)]);
      feedTotal = fc?.total;
      instance = s; name = s.name; invites = i.invites;
      users = u.users; next = u.next; total = u.total ?? 0; matched = u.matched ?? 0;
      starterSaved = starter = f.handle ?? ''; offered = f.offered; offeredFrom = f.from; starterChoices = f.choices;
      starterPick = starterSaved ? 'account' : 'default';
      void loadStarterPerson(starterSaved);
    } catch (e) {
      loadError = say(e);
      console.error('Admin failed to load', e);
    }
  }
  onMount(() => {
    if (!session.user?.isAdmin) return void goto('/new-posts', { replaceState: true });
    api.event('admin_view');
    void load();
  });

  /** Shows the change at once and puts the saved value back if saving fails. */
  /** Which setting is saving; its choices are held still until the answer comes back, so two quick picks can't land out of order. */
  let savingSetting = $state<'signups' | 'visitors' | null>(null);
  async function setPolicy(signups: SignupPolicy) {
    if (!instance || savingSetting) return;
    const was = instance.signups;
    instance.signups = signups;
    errors.signups = null;
    savingSetting = 'signups';
    try {
      instance = { ...instance, ...(await adminApi.update({ signups })) };
      api.event('instance_signups_changed', { signups });
    } catch (e) {
      instance.signups = was;
      errors.signups = say(e);
    } finally {
      savingSetting = null;
    }
  }
  async function setVisitorLimit(visitorLimit: boolean) {
    if (!instance || savingSetting) return;
    const was = instance.visitorLimit;
    instance.visitorLimit = visitorLimit;
    errors.visitors = null;
    savingSetting = 'visitors';
    try {
      instance = { ...instance, ...(await adminApi.update({ visitorLimit })) };
      api.event('instance_visitor_limit_changed', { visitorLimit });
    } catch (e) {
      instance.visitorLimit = was;
      errors.visitors = say(e);
    } finally {
      savingSetting = null;
    }
  }
  async function saveName() {
    if (!instance || savingName) return;
    if (name.trim() === instance.name) { editingName = false; return; }
    savingName = true; errors.name = null;
    try {
      instance = { ...instance, ...(await adminApi.update({ name: name.trim() })) };
      name = instance.name;
      editingName = false;
    } catch (e) {
      name = instance.name;
      errors.name = say(e);
    } finally {
      savingName = false;
    }
  }
  /** Closing the box goes back to what's saved: the account row, or Default when there's no account yet. */
  function cancelStarter() {
    starter = starterSaved; changingStarter = false; errors.starter = null;
    starterPick = starterSaved ? 'account' : 'default';
  }
  async function setStarter(handle: string): Promise<boolean> {
    if (savingStarter) return false;
    savingStarter = true; errors.starter = null;
    try {
      const r = await adminApi.setStarter(handle);
      starterSaved = starter = r.handle ?? ''; offered = r.offered; offeredFrom = r.from; starterChoices = r.choices;
      changingStarter = false;
      await loadStarterPerson(starterSaved);
      return true;
    } catch (e) {
      errors.starter = say(e);
      return false;
    } finally {
      savingStarter = false;
    }
  }
  /** With an account named, all of its collections that could be offered; the ticked ones are `offered`. */
  let starterChoices = $state<ExploreCollection[]>([]);
  /** A tick saves at once, like the choices above it, and goes back if saving fails. */
  async function pickStarter(id: number) {
    if (savingStarter) return;
    const ids = offered.some((c) => c.id === id) ? offered.filter((c) => c.id !== id).map((c) => c.id) : [...offered.map((c) => c.id), id];
    savingStarter = true; errors.starter = null;
    try {
      const r = await adminApi.setStarterPicks(ids);
      offered = r.offered; starterChoices = r.choices;
    } catch (e) {
      errors.starter = say(e);
    } finally {
      savingStarter = false;
    }
  }
  /** Default saves the moment it's picked, like the other choices on this tab, and goes back if saving fails. */
  async function pickDefault() {
    starterPick = 'default'; changingStarter = false; errors.starter = null;
    if (starterSaved && !(await setStarter(''))) starterPick = 'account';
  }
  function pickAccount() {
    starterPick = 'account'; errors.starter = null;
    if (!starterSaved) { starter = ''; changingStarter = true; }
  }

  // Invites
  const openInvites = $derived(invites.filter((i) => !i.usedAt && (!i.expiresAt || new Date(i.expiresAt).getTime() > Date.now())));
  const inviteName = (inv: Invite) => inv.note ?? 'Invite';
  const tabs = $derived([{ value: 'accounts', label: 'Accounts', count: total }, { value: 'feeds', label: 'Feeds', count: feedTotal }, { value: 'invites', label: 'Invites', count: openInvites.length }, { value: 'settings', label: 'Site settings' }]);
  async function mint() {
    if (minting) return;
    minting = true; errors.invites = null;
    try {
      const inv = await adminApi.createInvite(inviteNote.trim() || undefined);
      invites = [inv, ...invites];
      inviteNote = '';
      try { await navigator.clipboard.writeText(inv.url); showToast('Invite link copied'); } catch { showToast('Invite link made. Copy it from the list.'); }
      api.event('invite_created');
    } catch (e) {
      errors.invites = say(e);
    } finally {
      minting = false;
    }
  }
  async function copyInvite(inv: Invite) {
    try { await navigator.clipboard.writeText(inv.url); showToast('Invite link copied'); } catch { showToast(inv.url); }
  }
  let revoking = $state<Invite | null>(null);
  let revokeDialog = $state<HTMLDialogElement | null>(null);
  let revokeBusy = $state(false);
  function askRevoke(inv: Invite) { revoking = inv; revokeDialog?.showModal(); }
  async function revoke() {
    if (!revoking || revokeBusy) return;
    revokeBusy = true; errors.invites = null;
    const inv = revoking;
    try {
      await adminApi.revokeInvite(inv.code);
      invites = invites.filter((i) => i.code !== inv.code);
      showToast('Invite revoked');
    } catch (e) {
      errors.invites = say(e);
    } finally {
      revokeBusy = false;
      revokeDialog?.close();
    }
  }

  // Accounts: the one being managed, and what's happened to it in this Sheet.
  let managing = $state<AdminUser | null>(null);
  let manageDialog = $state<HTMLDialogElement | null>(null);
  let busy = $state(false);
  /** A freshly made temporary password, shown once. */
  let issued = $state<string | null>(null);
  let resetDialog = $state<HTMLDialogElement | null>(null);
  let deleteDialog = $state<HTMLDialogElement | null>(null);
  const label = (u: AdminUser) => u.displayName ?? `@${u.handle}`;

  function manage(u: AdminUser) {
    managing = u; issued = null; errors.manage = null;
    manageDialog?.showModal();
  }
  function replace(u: AdminUser) {
    users = users.map((x) => (x.id === u.id ? u : x));
    if (managing?.id === u.id) managing = u;
  }
  async function setAdmin(isAdmin: boolean) {
    const u = managing;
    if (!u || busy) return;
    busy = true; errors.manage = null;
    replace({ ...u, isAdmin });
    try {
      const r = await adminApi.setAdmin(u.id, isAdmin);
      replace({ ...u, isAdmin: r.isAdmin });
      api.event('admin_role_changed', { userId: u.id, isAdmin });
    } catch (e) {
      replace(u);
      errors.manage = say(e);
    } finally {
      busy = false;
    }
  }
  async function resetPassword() {
    const u = managing;
    if (!u || busy) return;
    busy = true; errors.manage = null;
    try {
      issued = (await adminApi.resetPassword(u.id)).password;
      api.event('admin_password_reset', { userId: u.id });
    } catch (e) {
      errors.manage = say(e);
    } finally {
      busy = false;
      resetDialog?.close();
    }
  }
  async function copyIssued() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued); showToast('Password copied'); } catch { showToast('Couldn’t copy it for you. Select the password to copy it.'); }
  }
  async function remove() {
    const u = managing;
    if (!u || busy) return;
    busy = true; errors.manage = null;
    try {
      await adminApi.deleteUser(u.id);
      users = users.filter((x) => x.id !== u.id);
      total -= 1; matched -= 1;
      api.event('admin_user_deleted', { userId: u.id });
      showToast(`Deleted @${u.handle}`);
      deleteDialog?.close();
      manageDialog?.close();
    } catch (e) {
      errors.manage = say(e);
      deleteDialog?.close();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Admin · thicket</title></svelte:head>

{#snippet site()}{instance?.name} <Dot /> <code>{instance?.url}</code>{/snippet}
<PageHeader name="Admin" description={instance ? site : undefined} />

{#if instance}
  <div class="pane">
    <Tabs class="scopes" {tabs} value={tab} onchange={pick} label="Parts of Admin" panel="admin-tab" fill />
  </div>
  <div id="admin-tab" role="tabpanel" aria-label={tabs.find((t) => t.value === tab)?.label}>
  {#if tab === 'feeds'}
    <AdminFeedList ontotal={(n) => (feedTotal = n)} />
  {:else if tab === 'accounts'}
  <Card kind="section" as="section" class="admin-section" aria-label="Accounts">
    <form role="search" onsubmit={(e) => { e.preventDefault(); clearTimeout(typing); void findAccounts(query.trim()); }}>
      <Field label="Search accounts" hideLabel>
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} inset variant="search" size="lg" enterkeyhint="search" bind:value={query} oninput={onSearch} placeholder="Search by name or @handle" autocomplete="off" autocapitalize="none" spellcheck={false}>
            {#snippet trailing()}<Button type="submit" variant="primary" disabled={!query.trim() && !searched}>Search</Button>{/snippet}
          </Input>
        {/snippet}
      </Field>
    </form>
    <p class="row-details found" role="status">{#if searching}Searching…{:else if searched}{plural(matched, 'account')} {matched === 1 ? 'matches' : 'match'} “{searched}”{/if}</p>
    {#if accountsError}<div class="err"><Banner tone="error" title="Couldn’t load accounts">{accountsError}</Banner></div>{/if}
    <div class="rows below">
      {#if users.length}
        <ul class="list-rows">
          {#each users as u (u.id)}
          <PersonRow person={{ ...u, bio: null }}>
            <span class="line">{plural(u.following, 'feed')} <Dot /> {plural(u.collections, 'collection')} <Dot /> {plural(u.bookmarks, 'bookmark')}</span>
            <span class="line">Joined {when(u.createdAt)}{#if u.invitedBy}{' '}via @{u.invitedBy}{/if}{#if u.lastSeenAt}{' '}<Dot />{' '}last active {when(u.lastSeenAt)}{/if}</span>
            {#snippet badges()}
              {#if u.isAdmin}<Badge>Admin</Badge>{/if}
              {#if u.profileVisibility === 'private'}<Badge>Private</Badge>{/if}
              {#if u.id === me?.id}<Badge>You</Badge>{/if}
            {/snippet}
            {#snippet end()}
              {#if u.id !== me?.id}<Button size="sm" onclick={() => manage(u)} aria-label="Manage @{u.handle}’s account"><Icon name="gear" size={16} />Manage account</Button>{/if}
            {/snippet}
          </PersonRow>
          {/each}
        </ul>
        {#if next}<button class="row-more tap" onclick={showMore} disabled={more || searching}>{more ? 'Loading…' : 'Show more'}</button>{/if}
      {:else if searched && !searching}
        <EmptyNote bare icon="search" title="No accounts match “{searched}”" text="Try part of their name or @handle." />
      {/if}
    </div>
  </Card>

  {:else if tab === 'invites'}
  <Card kind="section" as="section" class="admin-section" aria-labelledby="invites-h">
    <h2 class="section-title" id="invites-h">Invite links</h2>
    <p class="section-description">Each link works once and lasts two weeks.</p>
    <form class="inline" onsubmit={(e) => { e.preventDefault(); void mint(); }}>
      <Field label="Who’s it for?" hideLabel class="grow">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={inviteNote} placeholder="Who’s it for? (optional)" maxlength={120} />
        {/snippet}
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={minting}>New invite link</Button>
    </form>
    {#if errors.invites}<div class="err"><Banner tone="error" title="That didn’t work">{errors.invites}</Banner></div>{/if}
    <div class="rows below">
      {#if openInvites.length}
        <ul class="list-rows">
          {#each openInvites as inv (inv.code)}
            <li class="invite">
              <span class="what">
                <span class="row-name">{inviteName(inv)}</span>
                {#if inv.expiresAt}<span class="row-details">Expires {new Date(inv.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>{/if}
              </span>
              <span class="acts">
                <Button size="sm" onclick={() => copyInvite(inv)}><Icon name="copy" size={16} />Copy link</Button>
                <Button size="sm" variant="danger" link onclick={() => askRevoke(inv)}>Revoke</Button>
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <EmptyNote bare icon="link" title="No open invites" />
      {/if}
    </div>
  </Card>

  {:else}
  <Card kind="section" as="section" class="admin-section" aria-labelledby="signups-h">
    <h2 class="section-title" id="signups-h">Who can sign up</h2>
    <fieldset class="choices" aria-labelledby="signups-h">
      <label class="choice"><input type="radio" name="signups" checked={instance.signups === 'invite'} disabled={!!savingSetting} onchange={() => setPolicy('invite')} /><span><strong>Invite only</strong><small>People sign up with an invite link from you.</small></span></label>
      <label class="choice"><input type="radio" name="signups" checked={instance.signups === 'open'} disabled={!!savingSetting} onchange={() => setPolicy('open')} /><span><strong>Anyone</strong><small>Anyone who finds this site can sign up. On a public site, bots will make spam accounts, and there’s little to stop them.</small></span></label>
      <label class="choice"><input type="radio" name="signups" checked={instance.signups === 'closed'} disabled={!!savingSetting} onchange={() => setPolicy('closed')} /><span><strong>No one</strong><small>Nobody new can join. People who already have an account can still sign in.</small></span></label>
    </fieldset>
    {#if errors.signups}<div class="err"><Banner tone="error" title="Couldn’t save that">{errors.signups}</Banner></div>{/if}
  </Card>

  <Card kind="section" as="section" class="admin-section" aria-labelledby="visitors-h">
    <h2 class="section-title" id="visitors-h">What visitors can read</h2>
    <p class="section-description">Visitors are people who aren’t signed in.</p>
    <fieldset class="choices" aria-labelledby="visitors-h">
      <label class="choice"><input type="radio" name="visitors" checked={instance.visitorLimit} disabled={!!savingSetting} onchange={() => setVisitorLimit(true)} /><span><strong>The newest 100</strong><small>Feeds, collections, and profiles show their latest 100 items, then ask visitors to sign in.</small></span></label>
      <label class="choice"><input type="radio" name="visitors" checked={!instance.visitorLimit} disabled={!!savingSetting} onchange={() => setVisitorLimit(false)} /><span><strong>Everything</strong><small>Visitors can scroll back as far as anyone signed in.</small></span></label>
    </fieldset>
    {#if errors.visitors}<div class="err"><Banner tone="error" title="Couldn’t save that">{errors.visitors}</Banner></div>{/if}
  </Card>

  <Card kind="section" as="section" class="admin-section" aria-labelledby="starter-h">
    <h2 class="section-title" id="starter-h">Starter packs</h2>
    <p class="section-description">To get users started, their New posts page offers a set of “Starter pack” collections they can copy. Choose what you want to display.</p>
    <fieldset class="choices" aria-labelledby="starter-h">
      <label class="choice"><input type="radio" name="starter" checked={starterPick === 'default'} disabled={savingStarter} onchange={pickDefault} /><span><strong>Highest volume feeds</strong><small>The six public collections with the most feeds, from any account on your site.</small></span></label>
      <label class="choice"><input type="radio" name="starter" checked={starterPick === 'account'} disabled={savingStarter} onchange={pickAccount} /><span><strong>One account’s collections</strong><small>You might choose your own account, or create an account just for this purpose.</small></span></label>
    </fieldset>
    {#if starterPick === 'account'}
      <!-- Under its choice, lined up with the choice's words. -->
      <div class="pick">
        {#if starterSaved && !changingStarter}
          <ul class="list-rows">
            <PersonRow person={starterPerson ?? bare(starterSaved)}>
              {#snippet end()}<Button size="sm" onclick={() => { starter = starterSaved; changingStarter = true; }}><Icon name="pencil" size={16} />Change account</Button>{/snippet}
            </PersonRow>
          </ul>
        {:else}
          <form class="edit" onsubmit={(e) => { e.preventDefault(); void setStarter(starter); }}>
            <Field label="Account" error={errors.starter}>
              {#snippet children({ id, describedBy, invalid })}
                <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={starter} placeholder="@handle" autocomplete="off" autocapitalize="none" spellcheck={false} disabled={savingStarter} oninput={() => (errors.starter = null)} />
              {/snippet}
            </Field>
            <div class="editrow">
              <Button onclick={cancelStarter} disabled={savingStarter}>Cancel</Button>
              <Button type="submit" variant="primary" loading={savingStarter} disabled={!starter.trim()}>Save</Button>
            </div>
          </form>
        {/if}
      </div>
    {/if}
    {#if errors.starter && !(starterPick === 'account' && (!starterSaved || changingStarter))}
      <div class="err"><Banner tone="error" title="Couldn’t save that">{errors.starter}</Banner></div>
    {/if}
    {#if offeredFrom && starterChoices.length && !changingStarter}
      <!-- One account's: every collection of its new people could see, ticked for the ones they do. -->
      <h3 class="row-name offered-h">Feeds new people see:</h3>
      <div class="rows">
        <ul class="list-rows">
          {#each starterChoices as c (c.id)}
            <CollectionRow href={collectionHref(c.handle, c.slug)} name={c.name} description={c.description} feedCount={c.feedCount} sample={c.sample} picked={offered.some((o) => o.id === c.id)} disabled={savingStarter} onpick={() => void pickStarter(c.id)} />
          {/each}
        </ul>
      </div>
    {:else if offered.length}
      <!-- The field label's look (the shared row-name style), so it reads like "Account" above the box. -->
      <h3 class="row-name offered-h">Feeds new people see:</h3>
      <div class="rows">
        <ul class="list-rows">
          {#each offered as c (c.id)}
            <CollectionRow href={collectionHref(c.handle, c.slug)} name={c.name} description={c.description} feedCount={c.feedCount} owner={offeredFrom ? undefined : `@${c.handle}`} sample={c.sample} />
          {/each}
        </ul>
      </div>
    {/if}
  </Card>

  <Card kind="section" as="section" class="admin-section" aria-labelledby="name-h">
    <h2 class="section-title" id="name-h">Site name</h2>
    <p class="section-description">Shown on sign-up and sign-in pages and in link previews.</p>
    {#if editingName}
      <form class="edit" onsubmit={(e) => { e.preventDefault(); void saveName(); }}>
        <Field label="Site name" error={errors.name}>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={name} maxlength={60} placeholder={instance!.url.replace(/^https?:\/\//, '')} disabled={savingName} oninput={() => (errors.name = null)} />
          {/snippet}
        </Field>
        <div class="editrow">
          <Button onclick={() => { name = instance!.name; editingName = false; errors.name = null; }} disabled={savingName}>Cancel</Button>
          <Button type="submit" variant="primary" loading={savingName} disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    {:else}
      <div class="shown">
        <span class="row-name">{instance.name}</span>
        <Button size="sm" onclick={() => (editingName = true)}><Icon name="pencil" size={16} />Edit name</Button>
      </div>
    {/if}
  </Card>

  {/if}
  </div>

  <Sheet title={managing ? label(managing) : 'Manage account'} lede={managing?.displayName ? `@${managing.handle}` : undefined} bind:dialog={manageDialog} dismiss={false} locked={busy}>
    {#if managing}
      <div class="sheet-rows">
        <div>
          <span class="choice-text"><strong>Admin</strong><small>Can manage accounts, invites, and this page’s settings.</small></span>
          <div><ChoiceGroup size="sm" label="Admin" disabled={busy} options={[{ value: 'on', label: 'Enabled' }, { value: 'off', label: 'Disabled' }]} value={managing.isAdmin ? 'on' : 'off'} onchange={(v) => setAdmin(v === 'on')} /></div>
        </div>
        <div>
          <span class="choice-text"><strong>Password</strong><small>{issued ? 'Shown once. Pass it on however you like; they can change it in Settings.' : 'Gives them a temporary password and signs them out everywhere.'}</small></span>
          {#if issued}
            <div class="secret"><SecretValue value={issued} label="Temporary password" /><Button size="sm" onclick={copyIssued}><Icon name="copy" size={16} />Copy</Button></div>
          {:else}
            <div><Button disabled={busy} onclick={() => resetDialog?.showModal()}><Icon name="key" size={16} />Reset password</Button></div>
          {/if}
        </div>
      </div>
      {#if errors.manage}<Banner tone="error" title="That didn’t work">{errors.manage}</Banner>{/if}
    {/if}
    {#snippet footer()}
      <Button variant="primary" size="lg" disabled={busy} onclick={() => manageDialog?.close()}>Done</Button>
      <Button variant="danger" link disabled={busy} onclick={() => deleteDialog?.showModal()}>Delete account</Button>
    {/snippet}
  </Sheet>

  <Sheet title="Reset @{managing?.handle}’s password?" lede="Their current password stops working, and they’re signed out everywhere. You’ll get a temporary password to pass on." alert locked={busy} bind:dialog={resetDialog}>
    {#snippet footer()}
      <Button variant="primary" size="lg" loading={busy} onclick={resetPassword}><Icon name="key" size={16} />Reset password</Button>
    {/snippet}
  </Sheet>

  <Sheet title="Delete @{managing?.handle}’s account?" lede="Their collections, bookmarks, and notes are deleted with it. Feeds they follow stay on thicket. This can’t be undone." alert locked={busy} bind:dialog={deleteDialog}>
    {#snippet footer()}
      <Button variant="danger" solid size="lg" loading={busy} onclick={remove}>Delete account</Button>
    {/snippet}
  </Sheet>

  <Sheet title="Revoke {revoking ? `the invite for ${inviteName(revoking)}` : 'this invite'}?" lede="Its link stops working right away. You can make a new one anytime." alert locked={revokeBusy} bind:dialog={revokeDialog}>
    {#snippet footer()}
      <Button variant="danger" solid size="lg" loading={revokeBusy} onclick={revoke}>Revoke invite</Button>
    {/snippet}
  </Sheet>
{:else if loadError}
  <Banner tone="error" title="Couldn’t load Admin">{loadError}</Banner>
{:else}
  <p class="status">Loading…</p>
{/if}

<style>
  code { font-size: calc(var(--text-sm) * var(--size-app)); /* 1px vertical is optical: an inline code chip stays on the text's line. */ background: var(--surface-2); padding: 1px var(--space-2); border-radius: var(--radius-xs); overflow-wrap: anywhere; }
  /* The room between sections is set on the cards' own class, since the cards are drawn by the shared Card. */
  :global(.admin-section) { margin-bottom: var(--space-4); }
  /* The same row as Explore's and a profile's, with the same air under it. */
  .pane { margin-bottom: var(--space-2); }
  .pane :global(.scopes) { margin-bottom: var(--space-1); }
  /* Rows run to the card's edges, as on Import, so each row insets itself like any list row. */
  .rows { margin: 0 calc(-1 * var(--card-pad)) calc(-1 * var(--card-pad)); }
  /* Under the invite form, the same step a card puts before its controls. */
  .rows.below { margin-top: var(--space-3); }
  .line { display: block; }
  .found { margin: var(--space-3) 0 0; }
  /* Before any search it says nothing, and takes no room; it stays on the page so a search's result is still announced. */
  .found:empty { margin: 0; }
  /* A text box and its button side by side, the field taking the room. */
  .inline { display: flex; gap: var(--space-2); align-items: flex-start; }
  .inline :global(.grow) { flex: 1; min-width: 0; }
  .err { margin-top: var(--space-3); }
  /* Changing the account: the labeled box with Cancel and Save under it, as Edit profile does. */
  .edit { display: flex; flex-direction: column; gap: var(--space-3); }
  .editrow { display: flex; justify-content: flex-end; gap: var(--space-2); }
  /* A saved value and the button that edits it, on one line that wraps on a phone. */
  .shown { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
  .offered-h { margin: var(--space-5) 0 var(--space-1); }
  /* 28px is the option button (16px) plus the gap beside it, so the account sits under its choice's words. */
  .pick { margin: var(--space-2) 0 0 28px; }
  .pick .list-rows > :global(li) { padding: var(--space-2) 0; }

  .invite { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .what { flex: 1 1 12rem; min-width: 0; display: flex; flex-direction: column; }
  .what .row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acts { display: flex; align-items: center; gap: var(--space-3); margin-left: auto; }
  .choice-text { font-size: calc(var(--text-sm) * var(--size-app)); display: flex; flex-direction: column; gap: 2px; }
  .choice-text small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .secret { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .status { text-align: center; color: var(--text-2); padding: var(--space-6) 0; }
</style>
