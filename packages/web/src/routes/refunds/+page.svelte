<script lang="ts">
  import LegalPage from '$lib/components/LegalPage.svelte';
</script>

<LegalPage title="Refunds" updated="September 20, 2026">
  {#snippet children({ name })}
    <p>Paid plans on {name} are billed a year at a time. Here is how money comes back.</p>

    <h2>Trials</h2>
    <p>A trial takes a card up front and charges nothing until it ends. Cancel before then, from Settings, and you are never charged.</p>

    <h2>Within fourteen days of a charge</h2>
    <p>If you were charged, for the first year or for a renewal, and you ask within fourteen days, we refund the whole charge, no questions asked. Ask at <span class="placeholder">[support email]</span> with your handle.</p>

    <h2>After that</h2>
    <p>You can cancel at any time and keep the plan until the end of the period you paid for; we do not refund the remainder. If we shut the service down, or a mistake on our side charged you, we refund what is owed in full.</p>

    <h2>How</h2>
    <p>Refunds go back to the card that paid, through Stripe, usually within five to ten business days.</p>
  {/snippet}
</LegalPage>
