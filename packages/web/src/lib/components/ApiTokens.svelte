<script lang="ts">
  import { tokensApi, type ApiToken, type ApiTokenKind } from '$lib/api';
  import { longAgo } from '$lib/time';
  import { showToast } from '$lib/toast.svelte';
  import Button from './Button.svelte';

  /**
   * The API tokens section of the Account page (issue #140). Two tokens a
   * person can turn on, at most one of each: one that only reads, one that
   * can also change things. Each can be shown, copied and revoked.
   *
   * A token is hidden until asked for, like a password: this page is often
   * open while someone else can see the screen. Revoking asks first, in
   * place, because whatever is using the token stops working at once.
   *
   * `available` is the one switch for who gets tokens. Off, the section
   * still explains itself, nothing can be turned on, and `unavailable` says
   * why. A token that is already on stays listed so it can still be revoked.
   */
  interface Props {
    available?: boolean;
    unavailable?: string;
  }
  let { available = true, unavailable = 'API tokens aren’t available on this account.' }: Props = $props();

  const KINDS: { kind: ApiTokenKind; name: string; can: string }[] = [
    { kind: 'read', name: 'Read-only access', can: 'Can read your feeds, collections, bookmarks and notes. Can’t change anything.' },
    { kind: 'full', name: 'Full access', can: 'Can read everything, and also save bookmarks, write notes, and add or remove feeds and collections.' },
  ];

  let tokens = $state<Partial<Record<ApiTokenKind, ApiToken>>>({});
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let shown = $state<Partial<Record<ApiTokenKind, boolean>>>({});
  let confirming = $state<ApiTokenKind | null>(null);
  let busy = $state<ApiTokenKind | null>(null);

  const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

  $effect(() => {
    tokensApi.list()
      .then((r) => { tokens = Object.fromEntries(r.tokens.map((t) => [t.kind, t])); })
      .catch((e) => { error = say(e); })
      .finally(() => { loaded = true; });
  });

  /** The prefix says which kind it is, so it stays readable; the rest is dots. */
  const hidden = (token: string) => token.slice(0, 7) + '•'.repeat(24);

  async function enable(kind: ApiTokenKind) {
    if (busy) return;
    busy = kind; error = null;
    try {
      tokens[kind] = await tokensApi.enable(kind);
      shown[kind] = false;
    } catch (e) {
      error = say(e);
    } finally {
      busy = null;
    }
  }

  async function copy(kind: ApiTokenKind) {
    const t = tokens[kind];
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t.token);
      showToast('Token copied');
    } catch {
      // No clipboard here (an http address on a home network, say): show it so it can be copied by hand.
      shown[kind] = true;
      showToast('Couldn’t copy it for you. The token is shown so you can select it.');
    }
  }

  async function revoke(kind: ApiTokenKind) {
    if (busy) return;
    busy = kind; error = null;
    try {
      await tokensApi.revoke(kind);
      delete tokens[kind];
      shown[kind] = false;
      confirming = null;
      showToast('Token revoked');
    } catch (e) {
      error = say(e);
    } finally {
      busy = null;
    }
  }
</script>

<section class="card" class:off={!available} aria-labelledby="api-tokens-title">
  <h2 id="api-tokens-title">API tokens</h2>
  <p class="help">Let your own scripts and assistants read your thicket, or add to it. A token is a password for an application, so only give one to something you trust.</p>
  {#if !available}<p class="unavailable">{unavailable}</p>{/if}

  <ul class="kinds">
    {#each KINDS as k (k.kind)}
      {@const t = tokens[k.kind]}
      <li class="kind">
        <div class="head">
          <div class="what">
            <h3>{k.name}</h3>
            <p class="can">{k.can}</p>
          </div>
          {#if loaded && !t}
            <Button size="sm" disabled={!available || busy === k.kind} loading={busy === k.kind} onclick={() => enable(k.kind)}>Enable</Button>
          {/if}
        </div>

        {#if t}
          <div class="token">
            <code class="value" class:revealed={shown[k.kind]} aria-label={shown[k.kind] ? `${k.name} token` : `${k.name} token, hidden`}>{shown[k.kind] ? t.token : hidden(t.token)}</code>
            <div class="actions">
              <Button size="sm" aria-pressed={!!shown[k.kind]} onclick={() => (shown[k.kind] = !shown[k.kind])}>{shown[k.kind] ? 'Hide' : 'Show'}</Button>
              <Button size="sm" onclick={() => copy(k.kind)}>Copy</Button>
              {#if confirming !== k.kind}<Button size="sm" variant="danger" link onclick={() => (confirming = k.kind)}>Revoke</Button>{/if}
            </div>
          </div>
          <p class="used">{t.lastUsedAt ? `Last used ${longAgo(t.lastUsedAt)}.` : 'Not used yet.'} Turned on {longAgo(t.createdAt)}.</p>

          {#if confirming === k.kind}
            <div class="confirm" role="alertdialog" aria-labelledby="revoke-{k.kind}-q">
              <p id="revoke-{k.kind}-q">Revoke this token? Applications using it will stop working immediately.</p>
              <div class="confirmbtns">
                <Button size="sm" onclick={() => (confirming = null)}>Keep it</Button>
                <Button size="sm" variant="danger" disabled={busy === k.kind} loading={busy === k.kind} onclick={() => revoke(k.kind)}>Revoke</Button>
              </div>
            </div>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>

  {#if error}<p class="bad" role="alert">{error}</p>{/if}

  <p class="how">
    Send a token as <code>Authorization: Bearer</code> followed by the token. It works on the same API this site uses, which is described for applications at <a href="/api/openapi.json">/api/openapi.json</a>. A token can make 10 requests in any 10 seconds and 120 in any hour.
  </p>
</section>

<style>
  /* The card and its heading match the other sections of the Account page. */
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: var(--space-4); margin-bottom: var(--space-4); }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0 0 var(--space-3); line-height: 1.25; }
  h2 + .help { margin-top: calc(-1 * var(--space-2)); }
  .help, .how { margin: 0 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  .unavailable { margin: 0 0 var(--space-3); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.4; }

  .kinds { list-style: none; margin: 0; padding: 0; }
  .kind { padding: var(--space-4) 0; border-top: 1px solid var(--line); }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
  .what { min-width: 0; }
  h3 { margin: 0; font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; line-height: 1.3; }
  .can { margin: var(--space-1) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.4; }
  /* Off: the two kinds read as not on offer, while the explanation above stays at full strength. */
  .off .what { opacity: 0.6; }

  .token { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .value {
    flex: 1 1 16rem; min-width: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
    background: var(--surface-2); border: 1px solid var(--line);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: calc(var(--text-sm) * var(--size-app));
    color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: all;
  }
  /* Shown, the whole token has to be readable and selectable, so it wraps instead of trailing off. */
  .value.revealed { white-space: normal; overflow-wrap: anywhere; color: var(--text); }
  .actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  .used { margin: var(--space-2) 0 0; font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-2); }

  .confirm { margin-top: var(--space-3); padding: var(--space-3); border-radius: var(--radius-sm); border: 1px solid var(--danger); }
  .confirm p { margin: 0 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.4; }
  .confirmbtns { display: flex; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }

  .how { margin: 0; padding-top: var(--space-4); border-top: 1px solid var(--line); }
  .how code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.95em; }
  .how a { color: var(--accent); font-weight: 600; }
  .how a:hover { text-decoration: underline; }
  .bad { color: var(--danger); margin: 0 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
