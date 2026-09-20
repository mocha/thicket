<script lang="ts">
  import LegalPage from '$lib/components/LegalPage.svelte';
</script>

<LegalPage title="Terms of service" updated="September 20, 2026">
  {#snippet children({ name })}
    <p>These are the terms for using {name}, a hosted instance of the thicket software, run by <span class="placeholder">[operator's legal name]</span> ("we"). By making an account you agree to them. They are short on purpose; if something is unclear, ask us at <span class="placeholder">[support email]</span>.</p>

    <h2>The service</h2>
    <p>{name} fetches the public feeds of sites you choose and shows you their posts, lets you organise those sites into collections, save bookmarks, write notes, and share collections with other people. The software is free and open source under the AGPL; you can run your own copy at any time, and your collections can be copied from this instance to any other.</p>

    <h2>Your account</h2>
    <p>You need a handle and a password. Keep the password to yourself; you are responsible for what is done with your account. You must be at least 16 years old. One person, one account, unless we say otherwise.</p>

    <h2>Plans, trials and payment</h2>
    <p>Free accounts have limits, described on the <a href="/pricing">pricing page</a>. A paid plan is billed a year at a time through Stripe, our payment processor; we never see your card number. A trial takes a card up front and charges nothing until the trial ends. You can cancel at any time from Settings, and cancelling during a trial costs nothing. When a paid plan ends, your account returns to Free with everything you saved still there. Refunds are described in the <a href="/refunds">refund policy</a>. Prices may change; an existing subscription keeps its price for as long as it stays subscribed, and we will tell you in advance of any change that affects you.</p>

    <h2>What you may not do</h2>
    <ul>
      <li>Use the service to harass people, or publish notes or collections that are unlawful.</li>
      <li>Run automated tools against the service at a pace that harms it, or try to get around the limits of your plan.</li>
      <li>Use the service to fetch sites in ways their operators have asked not to be fetched.</li>
    </ul>
    <p>We may suspend or remove an account that does these things, and we will say why.</p>

    <h2>Your content and other people's</h2>
    <p>Your notes, bookmarks and collections are yours. Posts shown in the service belong to the sites that published them and are shown as their feeds provide them. If you publish a site and want it removed from this instance, tell us.</p>

    <h2>Leaving</h2>
    <p>You can export your collections, bookmarks and notes at any time, on any plan. To delete your account, ask us and we will remove it and everything it owns. Data that belongs to an account that has been closed, or whose subscription has ended, may be deleted after a year, with notice first.</p>

    <h2>No warranty</h2>
    <p>The service is provided as is. We run it with care, but we do not promise it will always be available or error-free, and to the extent the law allows we are not liable for losses that come from using it. Our total liability to you is limited to what you paid us in the twelve months before the claim.</p>

    <h2>Changes and law</h2>
    <p>We may update these terms; when we do, the date above changes and material changes are announced on the service. These terms are governed by the laws of the State of Texas, United States.</p>
  {/snippet}
</LegalPage>
