<script lang="ts">
  /**
   * What this instance costs. Public. On a self-hosted instance there is
   * nothing to sell and the page says so; on the hosted one it lays Free
   * beside Basic and starts the trial. The numbers come from the API's plan
   * table, so this page never disagrees with what is enforced.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { billingApi, priceLabel, type BillingStatus, type PlanLimits } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';

  let status = $state<BillingStatus | null>(null);
  let busy = $state(false);
  onMount(async () => { status = await billingApi.status(); });

  const me = $derived(session.user);
  const onBasic = $derived(!!me && me.plan !== 'free');

  async function start() {
    if (!me) return void goto('/signup?next=/pricing');
    busy = true;
    try {
      const { url } = await billingApi.checkout('/settings');
      window.location.href = url;
    } catch (e) {
      busy = false;
      showToast(e instanceof Error ? e.message : 'Could not start checkout');
    }
  }

  const n = (v: number | null, one: string, many: string) => (v === null ? `Unlimited ${many}` : `${v} ${v === 1 ? one : many}`);
  const rows = (l: PlanLimits) => [
    n(l.feeds, 'feed', 'feeds'),
    n(l.collections, 'collection', 'collections'),
    n(l.bookmarks, 'bookmark', 'bookmarks'),
    l.notes ? 'Notes on posts' : 'No notes',
    l.collectionView.perFeed !== null ? `The newest ${l.collectionView.perFeed} posts of each feed` : l.collectionView.days !== null ? 'A year of posts' : 'Every post',
    `${l.addFeedPerHour} new feeds an hour`
  ];
</script>

<svelte:head><title>Pricing · thicket</title></svelte:head>

<header class="top">
  <h1>Pricing</h1>
</header>

{#if !status}
  <p class="status">Loading…</p>
{:else if !status.enabled || !status.price}
  <section class="card">
    <h2>Nothing to buy here</h2>
    <p>This instance has no paid plans. thicket is open source: an instance is one small server, and whoever runs this one decides what accounts on it may do.</p>
  </section>
{:else}
  <p class="lead">thicket is open source and free to run yourself. The hosted instance costs money so that it never has to sell anything else. One plan, a year at a time, with a {status.trialDays}-day trial first.</p>
  <div class="plans">
    <section class="card plan">
      <h2>Free</h2>
      <p class="price">$0</p>
      <p class="help">A taste of everything, with room for a few feeds.</p>
      <ul>{#each rows(status.plans.free) as r}<li>{r}</li>{/each}</ul>
      {#if !me}<a class="btn" href="/signup?next=/pricing">Create an account</a>{/if}
    </section>
    <section class="card plan featured">
      <h2>Basic</h2>
      <p class="price">{priceLabel(status.price)}</p>
      <p class="help">Everything thicket does, for a year. The card is taken now; nothing is charged for {status.trialDays} days, and cancelling in that time costs nothing.</p>
      <ul>{#each rows(status.plans.basic) as r}<li>{r}</li>{/each}</ul>
      {#if onBasic}
        <p class="help">You have this. <a href="/settings#plan">Manage it in Settings.</a></p>
      {:else}
        <button class="btn primary" onclick={start} disabled={busy}>{busy ? 'One moment…' : `Start your ${status.trialDays}-day trial`}</button>
      {/if}
    </section>
  </div>
  <p class="fine">Cancel any time from Settings; your account returns to Free with everything you saved still there. Launch subscribers keep this price for as long as they stay subscribed. Export is never gated.</p>
{/if}

<style>
  .top { margin-bottom: 14px; }
  .lead { color: var(--text-2); max-width: 60ch; margin: 0 0 18px; }
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px; }
  .plan.featured { outline: 2px solid var(--accent); }
  h2 { font-size: calc(20px * var(--size-app)); margin: 0 0 4px; }
  .price { font-size: calc(28px * var(--size-app)); font-weight: 700; margin: 0 0 8px; }
  .help { color: var(--text-2); font-size: calc(14px * var(--size-app)); margin: 0 0 12px; }
  ul { margin: 0 0 16px; padding-left: 18px; color: var(--text); font-size: calc(15px * var(--size-app)); }
  li { margin: 4px 0; }
  .btn { display: inline-block; padding: 10px 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); font-weight: 600; text-decoration: none; cursor: pointer; font: inherit; }
  .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .btn:disabled { opacity: 0.6; }
  .fine { color: var(--text-2); font-size: calc(13px * var(--size-app)); margin-top: 18px; max-width: 70ch; }
  .status { color: var(--text-2); }
</style>
