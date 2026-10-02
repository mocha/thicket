<script lang="ts">
  /**
   * The foot of every marketing page (the landing page, About, Contact): the
   * licensing line on the left in quiet cream, and on the right the way to
   * About and Contact, a size up and underlined so they're plainly links.
   * They live here and not in the header, so the top of the page stays on the
   * product. On a phone the links drop under the licensing line.
   */
</script>

<footer>
  <p>thicket is free, open-source software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">AGPL</a>.<br /><a href="https://github.com/mocha/thicket" rel="noopener">Read the source</a> or run your own thicket site.</p>
  <nav aria-label="About thicket">
    <a href="/about">About the team</a>
    <a href="/contact">Contact us</a>
  </nav>
</footer>

<style>
  /* The last thing on the green, in quiet cream under a faint cream rule. */
  footer {
    position: relative; margin: calc(var(--space-6) * 3) 0 0; padding-top: var(--space-5);
    border-top: 1px solid color-mix(in srgb, #f6f1e8 18%, transparent);
    color: color-mix(in srgb, #f6f1e8 65%, transparent); font-size: calc(var(--text-sm) * var(--size-app));
    display: flex; flex-direction: column; gap: var(--space-5);
  }
  /* One sentence to a line. */
  p { margin: 0; text-wrap: pretty; }
  p a { color: #f6f1e8; font-weight: 600; }
  nav { display: flex; flex-direction: column; gap: var(--space-2); }
  nav a {
    color: #f6f1e8; font-weight: 600; font-size: calc(var(--text-base) * var(--size-app));
    text-decoration: underline; text-underline-offset: 4px;
  }
  @media (min-width: 640px) {
    /* The licensing line on the left, the links against the right edge. */
    footer { flex-direction: row; justify-content: space-between; align-items: flex-start; }
    nav { align-items: flex-end; text-align: right; }
  }
</style>
