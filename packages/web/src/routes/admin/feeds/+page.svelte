<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  // Preserve bookmarks and shared triage links from the standalone feed list.
  onMount(() => {
    const params = new URLSearchParams(page.url.searchParams);
    params.set('tab', 'feeds');
    void goto(`/admin?${params}`, { replaceState: true });
  });
</script>
