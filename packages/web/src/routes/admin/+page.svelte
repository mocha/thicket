<script lang="ts">
  /**
   * The instance, for its admins: who can sign up, invite links, the accounts.
   * Everything a small instance's owner does by hand today. Personal settings
   * stay on /settings; this page is about everyone else.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, adminApi, profileHref, type AdminUser, type InstanceStatus, type Invite, type SignupPolicy } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import type { StarterCandidate } from '$lib/api';
  import { relativeTime } from '$lib/time';
  import { showToast } from '$lib/toast.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Button from '$lib/components/Button.svelte';

  /**
   * "last active 23h ago" while relativeTime is still giving a relative form
   * (just now / 5m / 3h / 2d); once it falls back to an absolute date ("Aug
   * 12"), "ago" stops making sense, so we drop it: "last active Aug 12".
   */
  function lastActive(iso: string): string {
    const r = relativeTime(iso);
    if (r === 'just now' || /^\d+[mhd]$/.test(r)) return `last active ${r}${r === 'just now' ? '' : ' ago'}`;
    return `last active ${r}`;
  }

  const me = $derived(session.user);
  let instance = $state<(InstanceStatus & { signupsStored: SignupPolicy | null }) | null>(null);
  let name = $state('');
  let invites = $state<Invite[]>([]);
  let inviteNote = $state('');
  let minting = $state(false);
  let users = $state<AdminUser[]>([]);
  let busyId = $state<number | null>(null);
  /** A freshly minted temporary password, shown once. */
  let issued = $state<{ handle: string; password: string } | null>(null);
  /** Starter packs: one account's public collections are what a newcomer is offered. */
  let starterCandidates = $state<StarterCandidate[]>([]);
  let starter = $state<string | null>(null);
  let savingStarter = $state(false);

  async function setStarter(handle: string | null) {
    savingStarter = true;
    try {
      const r = await adminApi.setStarter(handle);
      starter = r.handle;
      showToast(starter ? `Newcomers are offered @${starter}'s collections` : 'Newcomers get the fullest public collections instead');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save');
    } finally {
      savingStarter = false;
    }
  }

  async function load() {
    const [s, i, u, f] = await Promise.all([adminApi.settings(), adminApi.invites(), adminApi.users(), adminApi.starter()]);
    instance = s; name = s.name; invites = i.invites; users = u.users;
    starterCandidates = f.candidates; starter = f.handle;
  }
  onMount(() => {
    if (!session.user?.isAdmin) return void goto('/', { replaceState: true });
    api.event('admin_view');
    void load();
  });

  async function setPolicy(signups: SignupPolicy) {
    if (!instance) return;
    instance = { ...instance, ...(await adminApi.update({ signups })) };
    api.event('instance_signups_changed', { signups });
    showToast(signups === 'open' ? 'Anyone can sign up' : signups === 'invite' ? 'Sign-ups need an invite' : 'Sign-ups closed');
  }
  async function setVisitorLimit(visitorLimit: boolean) {
    if (!instance) return;
    instance = { ...instance, ...(await adminApi.update({ visitorLimit })) };
    api.event('instance_visitor_limit_changed', { visitorLimit });
    showToast(visitorLimit ? 'Visitors see the newest 100' : 'Visitors see everything');
  }
  async function saveName() {
    if (!instance || name.trim() === instance.name) return;
    instance = { ...instance, ...(await adminApi.update({ name: name.trim() })) };
    name = instance.name;
    showToast('Instance name saved');
  }
  async function mint() {
    if (minting) return;
    minting = true;
    try {
      const inv = await adminApi.createInvite(inviteNote.trim() || undefined);
      invites = [inv, ...invites];
      inviteNote = '';
      try { await navigator.clipboard.writeText(inv.url); showToast('Invite link copied'); } catch { showToast('Invite created'); }
      api.event('invite_created');
    } finally {
      minting = false;
    }
  }
  async function copyInvite(inv: Invite) {
    try { await navigator.clipboard.writeText(inv.url); showToast('Invite link copied'); } catch { showToast(inv.url); }
  }
  async function revoke(inv: Invite) {
    await adminApi.revokeInvite(inv.code);
    invites = invites.filter((i) => i.code !== inv.code);
    showToast('Invite revoked');
  }
  const openInvites = $derived(invites.filter((i) => !i.usedAt && (!i.expiresAt || new Date(i.expiresAt).getTime() > Date.now())));

  async function setAdmin(u: AdminUser, isAdmin: boolean) {
    busyId = u.id;
    try {
      const r = await adminApi.setAdmin(u.id, isAdmin);
      users = users.map((x) => (x.id === u.id ? { ...x, isAdmin: r.isAdmin } : x));
      api.event('admin_role_changed', { userId: u.id, isAdmin });
      showToast(isAdmin ? `@${u.handle} is an admin now` : `@${u.handle} is no longer an admin`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      busyId = null;
    }
  }
  async function resetPassword(u: AdminUser) {
    if (!confirm(`Give @${u.handle} a new temporary password? Their current password stops working and they’re signed out everywhere.`)) return;
    busyId = u.id;
    try {
      issued = await adminApi.resetPassword(u.id);
      api.event('admin_password_reset', { userId: u.id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      busyId = null;
    }
  }
  async function copyIssued() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.password); showToast('Password copied'); } catch { /* it is on screen */ }
  }
  async function remove(u: AdminUser) {
    if (!confirm(`Delete @${u.handle}? Their collections and bookmarks go with them. Feeds stay in the index. This cannot be undone.`)) return;
    busyId = u.id;
    try {
      await adminApi.deleteUser(u.id);
      users = users.filter((x) => x.id !== u.id);
      api.event('admin_user_deleted', { userId: u.id });
      showToast(`Deleted @${u.handle}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      busyId = null;
    }
  }
</script>

<svelte:head><title>Admin · thicket</title></svelte:head>

<header class="top">
  <h1>Admin</h1>
  {#if instance}<p class="sub">{instance.name} · <code>{instance.url}</code></p>{/if}
</header>

{#if instance}
  <section class="card">
    <h2>This instance</h2>
    <form class="inline" onsubmit={(e) => { e.preventDefault(); void saveName(); }}>
      <label><span>Name</span><input type="text" bind:value={name} maxlength="60" placeholder={instance.url.replace(/^https?:\/\//, '')} /></label>
      <Button type="submit" size="sm" disabled={name.trim() === instance.name}>Save</Button>
    </form>
    <fieldset>
      <legend>Who can sign up</legend>
      <label class="radio"><input type="radio" name="signups" checked={instance.signups === 'invite'} onchange={() => setPolicy('invite')} /><span><strong>By invite</strong><small>You mint invite links below and send them to people.</small></span></label>
      <label class="radio"><input type="radio" name="signups" checked={instance.signups === 'open'} onchange={() => setPolicy('open')} /><span><strong>Anyone</strong><small>Right for a private network. On a public address, expect spam accounts.</small></span></label>
      <label class="radio"><input type="radio" name="signups" checked={instance.signups === 'closed'} onchange={() => setPolicy('closed')} /><span><strong>Nobody</strong><small>Existing accounts keep working.</small></span></label>
    </fieldset>
    <fieldset>
      <legend>What visitors without an account can read</legend>
      <label class="radio"><input type="radio" name="visitors" checked={instance.visitorLimit} onchange={() => setVisitorLimit(true)} /><span><strong>The newest 100</strong><small>Feed pages, collections, and people’s notes, bookmarks and activity show their 100 most recent items, then ask visitors to log in or make an account.</small></span></label>
      <label class="radio"><input type="radio" name="visitors" checked={!instance.visitorLimit} onchange={() => setVisitorLimit(false)} /><span><strong>Everything</strong><small>Visitors can scroll back as far as anyone signed in.</small></span></label>
    </fieldset>
  </section>

  <section class="card">
    <h2>Invite links</h2>
    <form class="mint" onsubmit={(e) => { e.preventDefault(); void mint(); }}>
      <input type="text" bind:value={inviteNote} placeholder="Who is this for? (optional note)" maxlength="120" />
      <Button type="submit" variant="primary" size="sm" disabled={minting}>{minting ? 'Creating…' : 'New invite link'}</Button>
    </form>
    {#if openInvites.length}
      <ul class="invites">
        {#each openInvites as inv (inv.code)}
          <li>
            <span class="note">{inv.note ?? 'Invite'}</span>
            <span class="exp">{inv.expiresAt ? `expires ${new Date(inv.expiresAt).toLocaleDateString()}` : ''}</span>
            <Button size="sm" onclick={() => copyInvite(inv)}>Copy link</Button>
            <Button variant="danger" size="sm" onclick={() => revoke(inv)}>Revoke</Button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="help">No open invites. Each link works once and lasts two weeks.</p>
    {/if}
  </section>

  <section class="card">
    <h2>Starter packs</h2>
    <p class="help">Someone who has just signed up follows nothing, so the first screen offers them collections to copy. Point it at an account and its public collections become those packs — curate them by signing in as that account and making collections the normal way. An account made for the purpose works well, and its profile doubles as a worked example: what it reads, saves and notes.</p>
    {#if starterCandidates.length}
      <ul class="packs">
        {#each starterCandidates as u (u.handle)}
          <li class:on={starter === u.handle}>
            <label>
              <input type="radio" name="starter" checked={starter === u.handle} disabled={savingStarter} onchange={() => void setStarter(u.handle)} />
              <span class="pk">
                <strong>{u.displayName ?? `@${u.handle}`}</strong>
                <small>@{u.handle} · {u.collectionCount} public {u.collectionCount === 1 ? 'collection' : 'collections'} · {u.feedCount} {u.feedCount === 1 ? 'site' : 'sites'}</small>
              </span>
            </label>
          </li>
        {/each}
        <li class:on={starter === null}>
          <label>
            <input type="radio" name="starter" checked={starter === null} disabled={savingStarter} onchange={() => void setStarter(null)} />
            <span class="pk">
              <strong>Nobody in particular</strong>
              <small>Fall back to the fullest public collections on the instance</small>
            </span>
          </label>
        </li>
      </ul>
    {:else}
      <p class="help">No account has a public collection yet. Once one does, it can be the starter account.</p>
    {/if}
  </section>

  <section class="card">
    <h2>Accounts <Badge>{users.length}</Badge></h2>
    {#if issued}
      <div class="issued" role="status">
        <p><strong>Temporary password for @{issued.handle}:</strong> <code>{issued.password}</code></p>
        <p class="help">Pass it on however you like. It won’t be shown again; they should change it in Settings.</p>
        <div class="row"><Button size="sm" onclick={copyIssued}>Copy</Button><Button size="sm" onclick={() => (issued = null)}>Done</Button></div>
      </div>
    {/if}
    <ul class="users">
      {#each users as u (u.id)}
        <li class:busy={busyId === u.id}>
          <Avatar handle={u.handle} name={u.displayName ?? u.handle} size={36} v={u.avatarUpdatedAt} />
          <div class="who">
            <div class="line">
              <a class="name" href={profileHref(u.handle)}>{u.displayName ?? u.handle}</a><span class="handle">{' · '}@{u.handle}{#if u.isAdmin}{' · '}<Badge>Admin</Badge>{/if}{#if u.profileVisibility === 'private'}{' · '}<Badge>Private</Badge>{/if}{#if u.id === me?.id}{' · '}<Badge>You</Badge>{/if}</span>
            </div>
            <div class="facts">{u.following} {u.following === 1 ? 'feed' : 'feeds'} · {u.collections} {u.collections === 1 ? 'collection' : 'collections'} · {u.bookmarks} {u.bookmarks === 1 ? 'bookmark' : 'bookmarks'} · joined {relativeTime(u.createdAt)}{#if u.invitedBy}{' via @'}{u.invitedBy}{/if}{#if u.lastSeenAt}{' · '}{lastActive(u.lastSeenAt)}{/if}</div>
            {#if u.id !== me?.id}
              <div class="acts">
                <Button size="sm" onclick={() => setAdmin(u, !u.isAdmin)} disabled={busyId === u.id}>{u.isAdmin ? 'Remove admin' : 'Make admin'}</Button>
                <Button size="sm" onclick={() => resetPassword(u)} disabled={busyId === u.id}>Reset password</Button>
                <Button variant="danger" size="sm" onclick={() => remove(u)} disabled={busyId === u.id}>Delete</Button>
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>
{:else}
  <p class="status">Loading…</p>
{/if}

<style>
  .top { margin-bottom: 14px; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  code { font-size: calc(var(--text-sm) * var(--size-app)); background: var(--surface-2); padding: 1px 6px; border-radius: 6px; }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; margin-bottom: 14px; }
  h2 { font-size: calc(var(--text-base) * var(--size-app)); margin: 0 0 10px; display: flex; align-items: baseline; gap: 8px; }
  .help { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .inline { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 14px; }
  .inline label { flex: 1; display: flex; flex-direction: column; gap: 6px; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  input[type='text'] { padding: 10px 13px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: calc(var(--text-base) * var(--size-app)); font-family: inherit; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  fieldset + fieldset { margin-top: 18px; }
  legend { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); padding: 0; margin-bottom: 6px; }
  .radio { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
  .radio input { margin-top: 3px; width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .radio span { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--text-sm) * var(--size-app)); }
  .radio small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .mint { display: flex; gap: 8px; }
  .mint input { flex: 1; min-width: 0; }
  .packs { list-style: none; margin: 12px 0; padding: 0; display: grid; gap: 6px; }
  .packs li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--bg); border: 1px solid transparent; }
  .packs li.on { border-color: var(--accent); }
  .packs label { display: flex; align-items: center; gap: 10px; flex: 1; cursor: pointer; }
  .packs input { accent-color: var(--accent); }
  .pk { display: flex; flex-direction: column; }
  .pk small { color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  @media (min-width: 760px) { .packs { grid-template-columns: repeat(2, 1fr); } }
  .invites { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .invites li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--bg); font-size: calc(var(--text-sm) * var(--size-app)); }
  .invites .note { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .invites .exp { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); white-space: nowrap; }
  .issued { background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid var(--accent); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
  .issued p { margin: 0 0 6px; font-size: calc(var(--text-sm) * var(--size-app)); }
  .issued code { font-size: calc(var(--text-base) * var(--size-app)); user-select: all; }
  .row { display: flex; gap: 8px; }
  .users { list-style: none; margin: 0; padding: 0; }
  .users li { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) 0; border-top: 1px solid var(--line); }
  .users li:first-child { border-top: 0; padding-top: var(--space-1); }
  .users li.busy { opacity: 0.6; }
  /* Two or three stacked rows, all aligned under the name (not the avatar):
     name + handle + badges, then the account facts, then the actions —
     skipped entirely on your own row, where the "You" badge on row one
     already says there is nothing to act on. */
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .line { line-height: 1.4; }
  .name { font-weight: 600; }
  .handle { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .facts { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .acts { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-1); }
  .status { text-align: center; color: var(--text-3); padding: 30px 0; }
</style>
