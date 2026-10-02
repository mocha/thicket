<script lang="ts">
  /**
   * The breadcrumb that heads a page sitting one step inside another:
   * "Core77 / Manage feed". It is the whole header: there is no big title
   * under it. Each place you came through is a link, in order, and the last
   * step is the page you are on, in plain text. Every step is the same size,
   * which is what makes it read as one trail. The last step is the page's h1,
   * so the page still has a title for screen readers and outlines.
   *
   * It replaces a "Back to …" link over a small "Managing …:" label over a
   * title: three lines that each said part of where you were.
   *
   * A long name in the trail is cut short with an ellipsis; on a narrow screen
   * the trail wraps rather than pushing the page sideways.
   */
  interface Props {
    /** The places above this page, outermost first. */
    trail: { label: string; href: string }[];
    /** This page. Not a link. */
    current: string;
    /** Off only where the page already has its own title, like the design-system page's example. */
    asTitle?: boolean;
  }

  let { trail, current, asTitle = true }: Props = $props();
</script>

<nav class="crumbs" aria-label="Breadcrumb">
  <ol>
    {#each trail as step (step.href)}
      <li>
        <a class="tap" href={step.href}>{step.label}</a>
        <span class="sep" aria-hidden="true">/</span>
      </li>
    {/each}
    <li class="here" aria-current="page">{#if asTitle}<h1>{current}</h1>{:else}{current}{/if}</li>
  </ol>
</nav>

<style>
  .crumbs { flex: 1; min-width: 0; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); font-size: calc(var(--text-xl) * var(--size-app)); }
  li { display: flex; align-items: center; gap: var(--space-2); min-width: 0; max-width: 100%; }
  a { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 0.2em; }
  /* The separator is decoration: the list order already says what leads where. */
  .sep { flex: none; color: var(--text-2); }
  .here { color: var(--text-2); }
  h1 { margin: 0; font: inherit; color: inherit; }
</style>
