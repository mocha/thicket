<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Dot from '$lib/components/Dot.svelte';
  /**
   * Site admin: the accounts, invite links, and the site-wide settings, for
   * the site's admins. Personal settings stay on Reading settings; this page
   * is about everyone else.
   *
   * Every setting is its own section card, built like Reading settings. Each
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
  import { api, adminApi, type AdminUser, type InstanceStatus, type Invite, type SignupPolicy } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { longAgo, relativeTime } from '$lib/time';
  import { plural } from '$lib/words';
  import { showToast } from '$lib/toast.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Button from '$lib/components/Button.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import EmptyNote from '$lib/components/EmptyNote.svelte';
  import Field from '$lib/components/Field.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Input from '$lib/components/Input.svelte';
  import PersonRow from '$lib/components/PersonRow.svelte';
  import SecretValue from '$lib/components/SecretValue.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Tabs from '$lib/components/Tabs.svelte';

  /** Which tab is open, kept in the address so Back and a shared link land on it. Accounts by default. */
  type Tab = 'accounts' | 'invites' | 'settings';
  const tab = $derived<Tab>(((t) => (t === 'invites' || t === 'settings' ? t : 'accounts'))(page.url.searchParams.get('tab')));
  function pick(v: string) {
    api.event('admin_tab', { tab: v });
    void goto(v === 'accounts' ? '/admin' : `/admin?tab=${v}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
  /** "Aug 12", or "2 hours ago" while it's recent enough to say so. */
  const when = (iso: string) => (/^\d+[mhd]$|^just now$/.test(relativeTime(iso)) ? longAgo(iso) : relativeTime(iso));

  const me = $derived(session.user);
  let instance = $state<(InstanceStatus & { signupsStored: SignupPolicy | null }) | null>(null);
  let loadError = $state<string | null>(null);
  /** What failed to save, by card, said on that card. */
  let errors = $state<Record<'signups' | 'visitors' | 'name' | 'starter' | 'invites' | 'manage', string | null>>({ signups: null, visitors: null, name: null, starter: null, invites: null, manage: null });

  let name = $state('');
  let savingName = $state(false);
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
      users = r.users; next = r.next; total = r.total; matched = r.matched; searched = q;
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
    if (!next || more) return;
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
  let starter = $state('');
  let savingStarter = $state(false);

  async function load() {
    try {
      const [s, i, u, f] = await Promise.all([adminApi.settings(), adminApi.invites(), adminApi.users(), adminApi.starter()]);
      instance = s; name = s.name; invites = i.invites;
      users = u.users; next = u.next; total = u.total; matched = u.matched;
      starter = f.handle ?? '';
    } catch (e) {
      loadError = say(e);
      console.error('Site admin failed to load', e);
    }
  }
  onMount(() => {
    if (!session.user?.isAdmin) return void goto('/new-posts', { replaceState: true });
    api.event('admin_view');
    void load();
  });

  /** Shows the change at once and puts the saved value back if saving fails. */
  async function setPolicy(signups: SignupPolicy) {
    if (!instance) return;
    const was = instance.signups;
    instance.signups = signups;
    errors.signups = null;
    try {
      instance = { ...instance, ...(await adminApi.update({ signups })) };
      api.event('instance_signups_changed', { signups });
    } catch (e) {
      instance.signups = was;
      errors.signups = say(e);
    }
  }
  async function setVisitorLimit(visitorLimit: boolean) {
    if (!instance) return;
    const was = instance.visitorLimit;
    instance.visitorLimit = visitorLimit;
    errors.visitors = null;
    try {
      instance = { ...instance, ...(await adminApi.update({ visitorLimit })) };
      api.event('instance_visitor_limit_changed', { visitorLimit });
    } catch (e) {
      instance.visitorLimit = was;
      errors.visitors = say(e);
    }
  }
  async function saveName() {
    if (!instance || savingName || name.trim() === instance.name) return;
    savingName = true; errors.name = null;
    try {
      instance = { ...instance, ...(await adminApi.update({ name: name.trim() })) };
      name = instance.name;
      showToast('Site name saved');
    } catch (e) {
      name = instance.name;
      errors.name = say(e);
    } finally {
      savingName = false;
    }
  }
  async function setStarter() {
    if (savingStarter) return;
    savingStarter = true; errors.starter = null;
    try {
      const r = await adminApi.setStarter(starter);
      starter = r.handle ?? '';
      showToast(starter ? `New people are offered @${starter}’s collections` : 'New people are offered the fullest public collections');
    } catch (e) {
      errors.starter = say(e);
    } finally {
      savingStarter = false;
    }
  }

  // Invites
  const openInvites = $derived(invites.filter((i) => !i.usedAt && (!i.expiresAt || new Date(i.expiresAt).getTime() > Date.now())));
  const inviteName = (inv: Invite) => inv.note ?? 'Invite';
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

<svelte:head><title>Site admin · thicket</title></svelte:head>

{#snippet site()}{instance?.name} <Dot /> <code>{instance?.url}</code>{/snippet}
<PageHeader name="Site admin" description={instance ? site : undefined} />

{#if instance}
  <div class="pane">
    <Tabs class="scopes" tabs={[{ value: 'accounts', label: 'Accounts', count: total }, { value: 'invites', label: 'Invites', count: openInvites.length }, { value: 'settings', label: 'Site settings' }]} value={tab} onchange={pick} label="Parts of Site admin" panel="admin-tab" fill />
  </div>
  <div id="admin-tab" role="tabpanel" aria-label={tab === 'accounts' ? 'Accounts' : tab === 'invites' ? 'Invites' : 'Site settings'}>
  {#if tab === 'accounts'}
  <Card kind="section" as="section" class="admin-section" aria-label="Accounts">
    <form role="search" onsubmit={(e) => { e.preventDefault(); clearTimeout(typing); void findAccounts(query.trim()); }}>
      <Field label="Search accounts" hideLabel>
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} inset type="search" bind:value={query} oninput={onSearch} placeholder="Search by name or @handle" autocomplete="off" autocapitalize="none" spellcheck={false} />
        {/snippet}
      </Field>
    </form>
    <p class="row-details found" role="status">{#if searching}Searching…{:else if searched}{plural(matched, 'account')} {matched === 1 ? 'matches' : 'match'} “{searched}”{:else}Newest first{/if}</p>
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
        {#if next}<button class="row-more tap" onclick={showMore} disabled={more}>{more ? 'Loading…' : 'Show more'}</button>{/if}
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
      <label class="choice"><input type="radio" name="signups" checked={instance.signups === 'invite'} onchange={() => setPolicy('invite')} /><span><strong>Invite only</strong><small>People sign up with an invite link from you.</small></span></label>
      <label class="choice"><input type="radio" name="signups" checked={instance.signups === 'open'} onchange={() => setPolicy('open')} /><span><strong>Anyone</strong><small>Anyone who finds this site can sign up. On a public site, bots will make spam accounts, and there’s little to stop them.</small></span></label>
      <label class="choice"><input type="radio" name="signups" checked={instance.signups === 'closed'} onchange={() => setPolicy('closed')} /><span><strong>No one</strong><small>Nobody new can join. People who already have an account can still sign in.</small></span></label>
    </fieldset>
    {#if errors.signups}<div class="err"><Banner tone="error" title="Couldn’t save that">{errors.signups}</Banner></div>{/if}
  </Card>

  <Card kind="section" as="section" class="admin-section" aria-labelledby="visitors-h">
    <h2 class="section-title" id="visitors-h">What visitors can read</h2>
    <p class="section-description">Visitors are people who aren’t signed in.</p>
    <fieldset class="choices" aria-labelledby="visitors-h">
      <label class="choice"><input type="radio" name="visitors" checked={instance.visitorLimit} onchange={() => setVisitorLimit(true)} /><span><strong>The newest 100</strong><small>Feeds, collections, and profiles show their latest 100 items, then ask visitors to sign in.</small></span></label>
      <label class="choice"><input type="radio" name="visitors" checked={!instance.visitorLimit} onchange={() => setVisitorLimit(false)} /><span><strong>Everything</strong><small>Visitors can scroll back as far as anyone signed in.</small></span></label>
    </fieldset>
    {#if errors.visitors}<div class="err"><Banner tone="error" title="Couldn’t save that">{errors.visitors}</Banner></div>{/if}
  </Card>

  <Card kind="section" as="section" class="admin-section" aria-labelledby="starter-h">
    <h2 class="section-title" id="starter-h">Starter packs</h2>
    <p class="section-description">New people are offered one account’s public collections to copy. Leave it blank to offer the site’s fullest public collections.</p>
    <form class="inline" onsubmit={(e) => { e.preventDefault(); void setStarter(); }}>
      <Field label="Account" hideLabel error={errors.starter} class="grow">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={starter} placeholder="@handle" autocomplete="off" autocapitalize="none" spellcheck={false} disabled={savingStarter} oninput={() => (errors.starter = null)} />
        {/snippet}
      </Field>
      <Button type="submit" size="lg" loading={savingStarter}>Save</Button>
    </form>
  </Card>

  <Card kind="section" as="section" class="admin-section" aria-labelledby="name-h">
    <h2 class="section-title" id="name-h">Site name</h2>
    <form class="inline" onsubmit={(e) => { e.preventDefault(); void saveName(); }}>
      <Field label="Site name" hideLabel error={errors.name} class="grow">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={name} maxlength={60} placeholder={instance!.url.replace(/^https?:\/\//, '')} oninput={() => (errors.name = null)} />
        {/snippet}
      </Field>
      <Button type="submit" size="lg" loading={savingName} disabled={name.trim() === instance.name}>Save</Button>
    </form>
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
          <span class="choice-text"><strong>Password</strong><small>{issued ? 'Shown once. Pass it on however you like; they can change it in Account and data.' : 'Gives them a temporary password and signs them out everywhere.'}</small></span>
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
  <Banner tone="error" title="Couldn’t load Site admin">{loadError}</Banner>
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
  /* A text box and its button side by side, the field taking the room. */
  .inline { display: flex; gap: var(--space-2); align-items: flex-start; }
  .inline :global(.grow) { flex: 1; min-width: 0; }
  .err { margin-top: var(--space-3); }
  .invite { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .what { flex: 1 1 12rem; min-width: 0; display: flex; flex-direction: column; }
  .what .row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acts { display: flex; align-items: center; gap: var(--space-3); margin-left: auto; }
  .choice-text { font-size: calc(var(--text-sm) * var(--size-app)); display: flex; flex-direction: column; gap: 2px; }
  .choice-text small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .secret { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .status { text-align: center; color: var(--text-2); padding: var(--space-6) 0; }
</style>
