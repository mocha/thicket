import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { languageLabel, languageSql, LanguageValidationError, parseLanguage } from "./language.js";

test("missing and empty language mean All, and Unknown is explicit", () => {
  for (const value of [null, undefined, "", " \t"]) assert.deepEqual(parseLanguage(value), { kind: "all" });
  assert.deepEqual(parseLanguage("unknown"), { kind: "unknown" });
});

test("language tags and aliases normalize like stored feed declarations", () => {
  for (const value of ["en", "EN", " en-US ", "en_gb", "eng"]) assert.deepEqual(parseLanguage(value), { kind: "code", code: "en" });
  for (const [value, code] of [["de-DE", "de"], ["ger", "de"], ["zh-Hant-TW", "zh"], ["pt_BR", "pt"], ["fil", "fil"]]) {
    assert.deepEqual(parseLanguage(value), { kind: "code", code });
  }
  for (const [value, code] of [["cnr", "sr"], ["sr-ME", "sr"], ["drw", "fa"], ["prs", "fa"], ["fa-AF", "fa"], ["swc", "sw"], ["sw-CD", "sw"]]) {
    assert.deepEqual(parseLanguage(value), { kind: "code", code });
  }
});

test("invalid languages never turn into All or Unknown", () => {
  for (const value of ["English", "all languages", "UNKNOWN", "un", "und", "x-default", "en-", "en-123456789", "en--US", "en_US!", "en or true", "';drop table feeds;--"]) {
    assert.throws(() => parseLanguage(value), LanguageValidationError, value);
  }
});

test("language predicates accept expressions and bind the code, never SQL text", () => {
  const dialect = new PgDialect();
  const compile = (value: string | null) => dialect.sqlToQuery(languageSql(sql`f.language`, parseLanguage(value)));
  assert.deepEqual(compile(null), { sql: "true", params: [] });
  assert.deepEqual(compile("unknown"), { sql: "f.language is null", params: [] });
  assert.deepEqual(compile("en-US"), { sql: "split_part(lower(f.language), '-', 1) = $1", params: ["en"], typings: ["none"] });
});

test("language options have readable labels with safe fallback", () => {
  assert.equal(languageLabel("en"), "English");
  assert.equal(languageLabel("de"), "German");
  assert.equal(languageLabel("invalid_language"), "invalid_language");
});
