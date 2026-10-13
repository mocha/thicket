/**
 * A "contains" pattern for `ilike ... escape '\'`: what someone typed, matched
 * literally, so a % or _ in it is a character rather than a wildcard.
 */
export const likeFor = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
