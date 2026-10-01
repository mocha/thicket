<!--
  The thicket behind the landing page's green top section: a still drawing,
  saved as two pictures in static/ by scripts/draw-thicket.mjs. The wide one,
  for laptops, is anchored at its center; the text always sits the same
  distance left of center there, so the clearing lines up at every width. The
  tall one, for phones, is anchored at its top, with the clearing across the
  top where the words sit. To change the drawing, run the script; where the
  clearing goes is measured from the page and written in it.

  Decoration only: screen readers skip it and it can't be clicked.
-->
<div class="frame" aria-hidden="true"></div>

<style>
  .frame {
    position: absolute; inset: 0; pointer-events: none;
    background: url('/thicket-tall.svg') center top / auto no-repeat;
  }
  @media (min-width: 820px) {
    .frame { background: url('/thicket-wide.svg') center / auto no-repeat; }
  }
</style>
