<script lang="ts">
  /**
   * The front page goes straight in: Everything for someone signed in, the
   * login screen for anyone else. thicket has no landing page of its own.
   * readthicket.com's lives in its own site, which the server hands / to when
   * SITE_URL is set; this page shows there only if that site can't be reached.
   */
  import { goto } from '$app/navigation';
  import { session } from '$lib/session.svelte';

  $effect(() => {
    if (session.loaded) void goto(session.user ? '/everything' : '/login', { replaceState: true });
  });
</script>
