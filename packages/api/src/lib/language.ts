import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { feedLanguage } from "../feeds/parse.js";

/** All is deliberately different from Unknown: Unknown means no declaration. */
export type LanguageFilter = { kind: "all" } | { kind: "unknown" } | { kind: "code"; code: string };

export class LanguageValidationError extends Error {
  constructor() {
    super("Choose a language code (for example en or en-US), unknown, or All languages.");
    this.name = "LanguageValidationError";
  }
}

/**
 * Match the normalization used when declared metadata is stored: tags such as
 * en-US and en_GB, and aliases such as eng, all select the stored base en.
 * A bad filter must never silently become All (nor Unknown).
 */
export function parseLanguage(value: string | null | undefined): LanguageFilter {
  const input = value?.trim() ?? "";
  if (!input) return { kind: "all" };
  if (input === "unknown") return { kind: "unknown" };
  const code = feedLanguage(input);
  if (!code) throw new LanguageValidationError();
  try {
    Intl.getCanonicalLocales(input.replace(/_/g, "-"));
  } catch {
    throw new LanguageValidationError();
  }
  // Some three-letter aliases expand to a regional tag (cnr → sr-ME,
  // drw/prs → fa-AF, swc → sw-CD). Metadata already stored those tags:
  // both the request and the stored side must select the same base language.
  return { kind: "code", code: code.split("-")[0].toLowerCase() };
}

/** Historical aliases can be stored as tags even though most rows are bare codes. */
export function storedLanguageSql(column: SQLWrapper): SQL {
  return sql`split_part(lower(${column}), '-', 1)`;
}
/** The column is a trusted SQL expression, never a caller-provided string. */
export function languageSql(column: SQLWrapper, language: LanguageFilter): SQL {
  if (language.kind === "all") return sql`true`;
  if (language.kind === "unknown") return sql`${column} is null`;
  return sql`${storedLanguageSql(column)} = ${language.code}`;
}

/** Stored codes may be uncommon; keep the code readable when ICU has no name. */
export function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language", fallback: "code" }).of(code) ?? code;
  } catch {
    return code;
  }
}
