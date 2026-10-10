<script lang="ts">
  /**
   * A list of people, each the shared Person row (name, @handle, bio), opening
   * their profile. Used for who someone follows (and your followers) in the
   * people Sheet, and on an empty profile's Overview, where it gives a visitor
   * somewhere to go.
   */
  import PersonRow from './PersonRow.svelte';
  import type { PublicUser } from '$lib/api';

  let { people, onopen }: { people: PublicUser[]; onopen?: () => void } = $props();
</script>

<ul class="list-rows">
  {#each people as p (p.handle)}
    <PersonRow person={p} {onopen} />
  {/each}
</ul>
