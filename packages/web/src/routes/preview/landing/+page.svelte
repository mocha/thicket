<script lang="ts">
  /**
   * The redesigned landing page, at an address nothing links to, so it can be
   * shared for review on the live site. Kept out of search results. The real
   * front door at / is unchanged until this replaces it.
   */
  import LandingPreview from '$lib/components/LandingPreview.svelte';
</script>

<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>

<LandingPreview />
