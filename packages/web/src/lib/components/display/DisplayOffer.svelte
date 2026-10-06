<script lang="ts">
  /**
   * The one-time offer to accounts from before saved settings existed (issue
   * #186): on a device they already use, ask whether new devices should offer
   * its settings. Use these saves them; ✕ is a no. Either answer is kept on
   * the account, so it never comes back on any device. It waits while setup
   * is open, and for a visit after setup, so the two never stack.
   */
  import { api, authApi } from '$lib/api';
  import { display } from '$lib/display.svelte';
  import { session } from '$lib/session.svelte';
  import { saveForNewDevices, setupVisit } from '$lib/saved-display.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Button from '$lib/components/Button.svelte';

  const u = $derived(session.user);
  const show = $derived(!!u && !u.displayOfferAnsweredAt && !u.savedDisplay && !!u.tourSeenAt && display.configured && !setupVisit.opened);
  let saving = $state(false);
  let seen = false;
  $effect(() => { if (show && !seen) { seen = true; api.event('display_offer_shown'); } });

  async function use() {
    saving = true;
    // Saving records the answer on the account, which hides this.
    await saveForNewDevices('offer');
    saving = false;
  }

  function decline() {
    if (!session.user) return;
    session.user.displayOfferAnsweredAt = new Date().toISOString();
    api.event('display_offer_declined');
    authApi.declineDisplayOffer();
  }
</script>

{#if show}
  <div class="offer">
    <Banner title="Use these settings on new devices?" dismissible ondismiss={decline}>
      <p>A new device you sign into will offer them</p>
      <Button variant="primary" size="sm" loading={saving} onclick={use}>Use these</Button>
    </Banner>
  </div>
{/if}

<style>
  .offer { margin: 0 0 var(--space-4); }
  .offer p { margin: 0 0 var(--space-2); }
</style>
