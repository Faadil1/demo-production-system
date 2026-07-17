import type { ValidationResult } from "./types.js";

export type BrowserAssertionKind =
  | "url-equals"
  | "url-matches"
  | "title-equals"
  | "element-visible"
  | "element-hidden"
  | "text-equals"
  | "text-contains"
  | "attribute-equals"
  | "count-equals"
  | "value-equals"
  | "screenshot-created";

export type BrowserAssertionStatus = "passed" | "failed" | "error";

export type BrowserAssertionResult = {
  readonly assertionId: string;
  readonly stepId: string;
  readonly kind: BrowserAssertionKind;
  readonly status: BrowserAssertionStatus;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly message: string;
  readonly observedAt: string;
  readonly relatedArtifactIds: readonly string[];
};

const MAX_REGEX_PATTERN_LENGTH = 200;
/** A conservative denylist of constructs prone to catastrophic backtracking. */
const DANGEROUS_REGEX_PATTERNS = [/(\+|\*){2,}/, /\([^)]*[+*]\)[+*]/];

export function validateRegexPattern(pattern: string): ValidationResult {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return {
      ok: false,
      issues: [{ path: "expected", code: "regex-too-long", message: `Pattern exceeds ${MAX_REGEX_PATTERN_LENGTH} characters.` }],
    };
  }
  if (DANGEROUS_REGEX_PATTERNS.some((bad) => bad.test(pattern))) {
    return {
      ok: false,
      issues: [{ path: "expected", code: "regex-too-complex", message: "Pattern contains a construct disallowed for safety (nested quantifiers)." }],
    };
  }
  try {
    new RegExp(pattern);
  } catch {
    return { ok: false, issues: [{ path: "expected", code: "invalid-regex", message: "Pattern is not a valid regular expression." }] };
  }
  return { ok: true };
}

const REDACTED = "[redacted]";

/**
 * Pure, deterministic comparison of an observed `actual` value against a step's
 * declared `expected` value. Never throws — an assertion the adapter could not even
 * observe is passed in as `observationError`, becoming status "error" rather than an
 * exception. When `sensitive` is true, the returned `expected`/`actual` are replaced
 * with a redaction marker after the (unredacted) comparison has already been made.
 */
export function evaluateAssertion(args: {
  readonly assertionId: string;
  readonly stepId: string;
  readonly kind: BrowserAssertionKind;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly observedAt: string;
  readonly relatedArtifactIds: readonly string[];
  readonly sensitive?: boolean;
  readonly observationError?: string;
}): BrowserAssertionResult {
  const base = {
    assertionId: args.assertionId,
    stepId: args.stepId,
    kind: args.kind,
    observedAt: args.observedAt,
    relatedArtifactIds: args.relatedArtifactIds,
  };

  if (args.observationError) {
    return {
      ...base,
      status: "error",
      expected: args.sensitive ? REDACTED : args.expected,
      actual: REDACTED,
      message: args.observationError,
    };
  }

  let passed: boolean;
  switch (args.kind) {
    case "url-equals":
    case "title-equals":
    case "attribute-equals":
    case "value-equals":
      passed = args.actual === args.expected;
      break;
    case "url-matches":
      passed =
        typeof args.actual === "string" &&
        typeof args.expected === "string" &&
        validateRegexPattern(args.expected).ok &&
        new RegExp(args.expected).test(args.actual);
      break;
    case "element-visible":
      passed = args.actual === true;
      break;
    case "element-hidden":
      passed = args.actual === false;
      break;
    case "text-equals":
      passed = args.actual === args.expected;
      break;
    case "text-contains":
      passed = typeof args.actual === "string" && typeof args.expected === "string" && args.actual.includes(args.expected);
      break;
    case "count-equals":
      passed = args.actual === args.expected;
      break;
    case "screenshot-created":
      passed = args.actual === true;
      break;
  }

  return {
    ...base,
    status: passed ? "passed" : "failed",
    expected: args.sensitive ? REDACTED : args.expected,
    actual: args.sensitive ? REDACTED : args.actual,
    message: passed
      ? "Assertion passed."
      : args.sensitive
        ? "Assertion failed (values redacted)."
        : `Expected ${JSON.stringify(args.expected)}, got ${JSON.stringify(args.actual)}.`,
  };
}
