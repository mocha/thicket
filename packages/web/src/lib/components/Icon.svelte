<script lang="ts">
  interface Props {
    name: 'gear' | 'pencil' | 'close' | 'caret' | 'back' | 'dots' | 'bookmark' | 'note' | 'search' | 'check' | 'key' | 'import' | 'copy' | 'eye' | 'eye-off';
    size?: number;
    stroke?: number;
    /** Paint the shape solid instead of outlining it: the on state of a toggle. */
    fill?: boolean;
    dir?: 'right' | 'down' | 'left' | 'up';
    class?: string;
  }
  let { name, size = 20, stroke = 2, fill = false, dir = 'right', class: klass = '' }: Props = $props();
  const rot = { right: 0, down: 90, left: 180, up: 270 } as const;
  /* The three dots are solid discs, so they are always painted and never outlined. */
  const solid = $derived(fill || name === 'dots');
</script>

<svg
  class={klass}
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill={solid ? 'currentColor' : 'none'}
  stroke={name === 'dots' ? 'none' : 'currentColor'}
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  style={name === 'caret' ? `transform: rotate(${rot[dir]}deg); transition: transform 120ms ease` : null}
>
  {#if name === 'gear'}
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  {:else if name === 'pencil'}
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6L6 18" />
  {:else if name === 'caret'}
    <path d="M9 6l6 6-6 6" />
  {:else if name === 'back'}
    <path d="M15 6l-6 6 6 6" />
  {:else if name === 'dots'}
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  {:else if name === 'bookmark'}
    <path d="M6 4h12v17l-6-4-6 4z" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  {:else if name === 'check'}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === 'key'}
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  {:else if name === 'import'}
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  {:else if name === 'copy'}
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1" />
  {:else if name === 'eye'}
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  {:else if name === 'eye-off'}
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  {:else if name === 'note'}
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H5.5A1.5 1.5 0 0 1 4 14.5z" />
  {/if}
</svg>
