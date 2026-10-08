<script lang="ts">
  /**
   * Follow for a person: one tap, a green outline, tinted green once you
   * follow. It wears the same look as a feed's Follow (FollowControl), which
   * also asks which collection the feed goes in.
   *
   * With `href` it's a link instead, for someone signed out: "Follow" takes
   * them to sign in first.
   */
  interface Props {
    following?: boolean;
    /** What it says before you follow, such as "Follow @maya". */
    label?: string;
    busy?: boolean;
    /** The small size every page header's buttons use. */
    small?: boolean;
    href?: string;
    onclick?: () => void;
  }

  let { following = false, label = 'Follow', busy = false, small = false, href, onclick }: Props = $props();
</script>

{#if href}<a class="follow tap" class:small {href}>{label}</a>
{:else}<button type="button" class="follow tap" class:small class:on={following} disabled={busy} aria-pressed={following} {onclick}>{following ? 'Following' : label}</button>{/if}

<style>
  .follow { flex: none; display: inline-flex; align-items: center; padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--accent); background: var(--surface); color: var(--accent); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; white-space: nowrap; text-decoration: none; }
  .follow:hover { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
  .follow.on { background: var(--accent-tint); border-color: transparent; }
  .follow.on:hover { background: var(--accent-tint); border-color: var(--accent); }
  .follow:disabled { opacity: 0.6; }
  .small { padding: var(--space-1) var(--space-3); }
</style>
