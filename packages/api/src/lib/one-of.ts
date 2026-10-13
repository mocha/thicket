/**
 * A query parameter that takes one word from a fixed list, such as a list's
 * sort. Anything else, including nothing, is the fallback, so a mistyped or
 * outdated link still loads.
 */
export const oneOf =
  <T extends string>(list: readonly T[], fallback: T) =>
  (v: string | null | undefined): T =>
    (list as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
