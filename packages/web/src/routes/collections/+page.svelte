<script lang="ts">
  /** /collections no longer exists: your profile lists your collections. Old links land there. */
  import { goto } from '$app/navigation';
  import { session } from '$lib/session.svelte';
  import { profileHref } from '$lib/api';
  $effect(() => { if (session.loaded) void goto(session.user ? profileHref(session.user.handle) : '/', { replaceState: true }); });
</script>
