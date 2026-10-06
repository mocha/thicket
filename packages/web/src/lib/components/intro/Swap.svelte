<script lang="ts">
  /** Words in a tour picture that change partway through, "just now" to "1 min". At rest, the second. */
  let { from, to, at }: { from: string; to: string; /** When to change, in ms from the start of the round. */ at: number } = $props();
</script>

<span class="swap" style:--at="{at}ms"><span class="from">{from}</span><span class="to">{to}</span></span>

<style>
  .swap { display: inline-grid; }
  .swap > span { grid-area: 1 / 1; }
  .from { opacity: 0; animation: from var(--at) linear backwards; }
  .to { animation: to 300ms ease-out var(--at) backwards; }
  @keyframes from { from, 99% { opacity: 1; } to { opacity: 0; } }
  @keyframes to { from { opacity: 0; } }
</style>
