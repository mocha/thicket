<script lang="ts">
  /**
   * Where the landing page was reviewed before it went live. Links to it were
   * shared, so it sends people on to the real one.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => void goto('/', { replaceState: true }));
</script>
