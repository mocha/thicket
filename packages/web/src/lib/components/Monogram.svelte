<script lang="ts">
  /** Self-contained stand-in for a favicon: no third-party icon service to rot. */
  let { name, size = 22 }: { name: string | null; size?: number } = $props();
  const letter = $derived((name ?? '?').trim().charAt(0).toUpperCase() || '?');
  const hue = $derived([...(name ?? '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7));
</script>

<span class="mono" style:--s="{size}px" style:--h={hue} aria-hidden="true">{letter}</span>

<style>
  .mono {
    display: inline-grid; place-items: center; flex: none;
    width: var(--s); height: var(--s); border-radius: var(--radius-avatar);
    /* Deliberately literal: the ground here is a hue picked from the person’s name, not a
       palette color, so the initials are white on every theme. */
    background: hsl(var(--h) 35% 45%); color: #fff;
    font-size: calc(var(--s) * 0.55); font-weight: 700; line-height: 1;
  }
</style>
