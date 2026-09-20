<script lang="ts">
  import LegalPage from '$lib/components/LegalPage.svelte';
</script>

<LegalPage title="Privacy" updated="September 20, 2026">
  {#snippet children({ name })}
    <p>{name} is run by <span class="placeholder">[operator's legal name]</span>. This page says what we keep, why, and what we do not. The short version: what you read is your business. We do not build a profile of you, we do not sell anything about you, and there is nothing to sell because we do not collect it.</p>

    <h2>What we keep</h2>
    <ul>
      <li><strong>Your account:</strong> a handle, a password (stored hashed, never readable), and the profile details you choose to add. No email address is needed for a free account.</li>
      <li><strong>What you make:</strong> your collections, bookmarks and notes, and your settings, including who may see each part of your profile.</li>
      <li><strong>A session cookie</strong> so you stay signed in. It carries a random token, nothing else, and expires after thirty days without use.</li>
      <li><strong>If you subscribe:</strong> your email address and billing address, which Stripe collects at checkout and we keep so a receipt can be traced to an account and renewals can be announced. Stripe processes your card; we never see the number. Stripe's own policy is at <a href="https://stripe.com/privacy" rel="noopener">stripe.com/privacy</a>.</li>
      <li><strong>Product usage, unless you opt out:</strong> counts of what features are used, such as a feed being added or a bookmark saved, and page views within the service. This is to see what is used and what is not. You can turn it off for your account in Settings, and the instance can turn it off for everyone. It is kept for ninety days.</li>
      <li><strong>Server logs</strong> of requests, kept briefly for keeping the service running.</li>
    </ul>

    <h2>What we do not keep</h2>
    <p>A history of what you read. Opening a post is not recorded against you in any way that persists beyond the usage counts above, which you can switch off. We do not track you across other sites, and there is no advertising.</p>

    <h2>What other people can see</h2>
    <p>Only what you choose to share. Your profile, collections, bookmarks and notes each have an audience setting, and everything can be made private. A collection you share by link is visible to whoever has the link, within the audience you set.</p>

    <h2>Where it lives</h2>
    <p>The service runs on hosting providers in the United States. Feeds are fetched by our servers, so the sites you follow see our servers, not you.</p>

    <h2>Your control</h2>
    <p>You can export your collections, bookmarks and notes at any time. You can change or delete what you have made. To delete your account and everything it owns, ask us at <span class="placeholder">[support email]</span>. If you are in the EU, UK or another place with data protection rights, you have the rights those laws give you, and we will honour them.</p>

    <h2>Changes</h2>
    <p>If this page changes in a way that matters, the date above changes and we say so on the service.</p>
  {/snippet}
</LegalPage>
