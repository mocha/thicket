<script lang="ts">
  /** A profile's Activity tab, at /@handle/activity: everything they've been up to, newest first, a page at a time. */
  import { getProfileContext } from '$lib/profile.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';

  const ctx = getProfileContext();
  const profile = $derived(ctx.profile);
</script>

<ActivityList handle={profile.handle} isMe={profile.isMe} />
