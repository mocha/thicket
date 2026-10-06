<script lang="ts">
  /**
   * "Who sees this" in miniature, drawn like the real choice group: boxes that
   * share their lines, the chosen one in an accent wash with an accent
   * outline. Partway through, the choice moves from one option to another. At
   * rest, the second is chosen.
   */
  const OPTIONS = ['Only me', 'People I follow', 'Anyone'];
  let { from, to, at }: { from: string; to: string; /** ms from the start of the round. */ at: number } = $props();
</script>

<span class="cg" style:--at="{at}ms">
  {#each OPTIONS as o (o)}<span class="opt" class:was={o === from} class:now={o === to}>{o}</span>{/each}
</span>

<style>
  .cg { display: inline-flex; }
  .opt {
    position: relative; padding: 3px 8px; margin-left: -1px; font-size: 10px; font-weight: 600; white-space: nowrap;
    background: var(--surface); border: 1px solid var(--line); color: var(--text-2);
  }
  .opt:first-child { margin-left: 0; border-radius: 6px 0 0 6px; }
  .opt:last-child { border-radius: 0 6px 6px 0; }
  .now { z-index: 1; background: var(--accent-tint); border-color: var(--accent); color: var(--accent); animation: picked 220ms ease-out var(--at) backwards; }
  .was { animation: unpicked var(--at) steps(1) backwards; }
  @keyframes picked { from { background: var(--surface); border-color: var(--line); color: var(--text-2); } }
  @keyframes unpicked { from { z-index: 1; background: var(--accent-tint); border-color: var(--accent); color: var(--accent); } }
</style>
