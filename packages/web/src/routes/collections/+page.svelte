<script lang="ts">
  /**
   * Your collections, on their own: the screen the Collections tab opens. It is
   * the Collections section of your profile and nothing else of it, so it is
   * drawn by the same component and can't drift from what the profile shows.
   */
  import { session } from '$lib/session.svelte';
  import ProfilePage from '$lib/components/ProfilePage.svelte';
</script>

{#if session.user}
  <ProfilePage handle={session.user.handle} only="collections" />
{/if}
