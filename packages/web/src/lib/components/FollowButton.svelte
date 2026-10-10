<script lang="ts">
  /**
   * Follow for a person: one tap. It's the shared small Button: the pale
   * green secondary look while it asks to be pressed, the plain ghost look
   * once you follow, so the done state steps back. A feed's Follow
   * (FollowControl) wears the same two looks; it also asks which collection
   * the feed goes in.
   *
   * With `href` it's a link instead, for someone signed out: "Follow" takes
   * them to sign in first.
   */
  import Button from './Button.svelte';

  interface Props {
    following?: boolean;
    /** What it says before you follow, such as "Follow @maya". */
    label?: string;
    busy?: boolean;
    href?: string;
    onclick?: () => void;
    /** For the screen to place the button. */
    class?: string;
  }

  let { following = false, label = 'Follow', busy = false, href, onclick, class: klass = '' }: Props = $props();
</script>

{#if href}<Button size="sm" variant="secondary" class="follow {klass}" {href}><span class="lbl">{label}</span></Button>
{:else}<Button size="sm" variant={following ? 'ghost' : 'secondary'} class="follow {klass}" disabled={busy} aria-pressed={following} {onclick}><span class="lbl">{following ? 'Following' : label}</span></Button>{/if}

<style>
  /* A long label is cut short rather than pushing the page wider; the words clip themselves so the touch area can still reach past the edges. */
  .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
