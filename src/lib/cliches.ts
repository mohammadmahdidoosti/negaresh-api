/**
 * Compatibility façade over the diagnostic linter.
 * Destructive regex→empty replacements are retired; callers should use `lintText`.
 */
export { countLintHits as countClicheHits, LINT_RULES } from "./linter";
