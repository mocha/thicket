<!--
  The dot between items on one line: "1,254 posts · 3 following". One piece so
  every dot in the app is the same weight. Screen readers skip it; the words on
  either side read as separate items anyway.
-->
<span class="dot" aria-hidden="true">·</span>

<style>
  /* Heavier and larger than the plain character, without making the line any taller. */
  .dot { display: inline-block; font-weight: 900; font-size: 1.35em; line-height: 0; vertical-align: -0.06em; color: var(--text-3); }
</style>
