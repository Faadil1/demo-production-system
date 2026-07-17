# RFC-0004 — Browser Evidence Capture

## Status

Reference implementation complete. Extension adapters pending.

## Purpose

Give DPS the ability to create its **own** verified product evidence by executing an
explicit, deterministic browser capture plan against a local (or explicitly allowlisted
remote) web application — rather than relying only on manifest hints (RFC-0002) or
externally supplied observations (RFC-0003). The system never invents what happened:
every evidence item is connected to a requested action, an observed browser state, an
assertion result, and a concrete artifact (screenshot, DOM snapshot, URL, or console
record).

## Scope

Implemented: browser target and capture-plan contracts, a safety policy, a replaceable
`BrowserAdapter` interface with a Playwright Chromium reference implementation,
deterministic action execution, browser assertions, screenshot and sanitized DOM
snapshot capture, a browser-generated `DemoObservationTimeline` (RFC-0003-compatible),
an evidence manifest, a Capture Gate, the `BrowserCaptureEngine`, the
`capture-browser` CLI, and a one-way bridge into RFC-0002-shaped `EvidenceItem`s.

Explicitly out of scope (see Future extension points): automatic product exploration or
AI-based interaction planning, visual computer vision, OCR, automatic semantic
understanding, automatic login/CAPTCHA bypass, remote browser providers, video/trace
recording, and Remotion rendering.

## Contracts

| File | Purpose |
|---|---|
| `src/core/browser-target.ts` | `BrowserTarget` (`local` / `explicit-remote`) + `validateBrowserTarget`. |
| `src/core/browser-selector.ts` | `BrowserSelector` union (test-id, role, label, text, css) + `validateSelector`. |
| `src/core/browser-capture-policy.ts` | `BrowserCapturePolicy` safety policy + safe defaults + `validateCapturePolicy`. |
| `src/core/browser-capture-plan.ts` | `BrowserCapturePlan`, all 9 step kinds, `BrowserEvidenceRequirement`, `validateCapturePlan`. |
| `src/core/browser-assertion.ts` | `BrowserAssertionResult` + pure `evaluateAssertion` (comparison only, no I/O). |
| `src/core/browser-network.ts` | `BrowserNetworkRecord`, URL sanitization, origin classification. |
| `src/core/browser-capture-artifacts.ts` | Screenshot/DOM-snapshot/console/step-result/safety-violation types. |
| `src/core/dom-sanitizer.ts` | Pure, dependency-free HTML sanitizer for DOM snapshots. |
| `src/core/browser-evidence-manifest.ts` | `BrowserEvidenceManifest`, coverage, requirement results. |
| `src/core/browser-capture-result.ts` | Top-level `BrowserCaptureResult` + `BrowserCaptureGate`. |
| `src/core/capture-input.ts` | Ajv2020 schema loader/validator for `capture.yaml`. |
| `src/adapters/browser-adapter.ts` | Replaceable `BrowserAdapter` interface + raw `BrowserAdapterExecution` shape. |
| `src/adapters/playwright-browser-adapter.ts` | Reference implementation using Playwright Chromium. |
| `src/engines/browser-capture.ts` | `BrowserCaptureEngine` — pure domain logic over the adapter's raw output. |
| `src/bridges/browser-capture-to-understanding.ts` | One-way bridge into RFC-0002 `EvidenceItem`s. |
| `src/cli/capture-browser.ts` | `npm run capture-browser` entrypoint. |

## Architecture: adapter vs. engine

The adapter (`PlaywrightBrowserAdapter`) only *observes*: it drives the real browser and
reports `actual` values for each assertion, raw step outcomes, and captured artifacts —
it never decides pass/fail. `BrowserCaptureEngine` is pure domain logic layered on top:
it compares `actual` against the plan's declared `expected` (`evaluateAssertion`),
generates observations, computes evidence coverage, and computes the Capture Gate. This
split is what makes the engine's decision logic (`tests/browser-capture-engine.test.ts`)
fully testable with a fake adapter — no real browser required — while the adapter itself
is separately integration-tested against a real local page
(`tests/playwright-browser-adapter.test.ts`).

## Safety model

**Target restrictions** (`validateBrowserTarget`): only `http:`/`https:`; embedded
credentials (`user:pass@host`) rejected; `local` targets must resolve to `localhost`,
`127.0.0.1`, or `::1`; `explicit-remote` targets require their origin present in
`policy.allowedOrigins`. `file://`, `data:`, `javascript:`, `ftp:`, `chrome:` and other
protocols are always rejected. HTTP is never silently rewritten to HTTPS or vice versa.

**Capture policy** (`BrowserCapturePolicy`, safe by default): all sensitive browser
capabilities (downloads, popups, clipboard, geolocation, notifications, camera,
microphone, service workers, file uploads) default to `false`; third-party requests are
blocked by default; step count and total duration are bounded
(`maximumSteps` ≤ 500, `maximumDurationMs` ≤ 30 min).

**Playwright adapter hardening**: a fresh isolated `BrowserContext` per capture (never a
persistent user profile), all permissions denied, no cookies/storage state persisted,
deterministic `locale: en-US`, `timezoneId: UTC`, `colorScheme: light`,
`reducedMotion: reduce`, HTTPS errors never ignored, no stealth plugins, no Node
integration exposed to page content, popups/downloads intercepted and closed/cancelled
unless explicitly allowed, navigation/redirects restricted to allowed origins with
blocked attempts recorded as `BrowserSafetyViolation`s, and page/context/browser closed
in a `finally` block even on failure. A subtlety worth documenting: Playwright's
`context.on("page", ...)` event fires for the *primary* page created by
`context.newPage()` too, not only genuine popups — the adapter explicitly excludes the
primary page instance from popup handling to avoid closing itself.

**Selector policy**: preference order is test-id → accessible role/name → label → exact
visible text → CSS as a last resort. XPath is not supported.

**Action model**: only left-click with `clickCount: 1` is enabled by default (right-click
and multi-click are rejected at plan-validation time). `press` is restricted to a
documented key allowlist (`Enter`, `Tab`, `Escape`, arrow keys, `Backspace`, `Delete`,
`Space`). A `wait-for` of type `timeout` is supported but discouraged (arbitrary waits
are inherently less deterministic than waiting on a condition).

## Assertion model

`evaluateAssertion` is a pure function: given `expected` (from the plan) and `actual`
(observed by the adapter), it returns `passed` / `failed` / `error` — never throwing.
Regex assertions (`url-matches`) are length-bounded (≤200 chars) and rejected if they
contain nested-quantifier patterns prone to catastrophic backtracking. When a step is
marked `sensitive` (or the adapter marks the observation sensitive), both `expected` and
`actual` are replaced with `"[redacted]"` in the stored result — the pass/fail
determination is still made against the real underlying values first, only the recorded
output is redacted. Failed assertions are never converted into thrown exceptions or
deleted; they remain in the output as first-class evidence.

## Screenshot and DOM artifact handling

Screenshots are PNG-only, written directly to `<run-dir>/screenshots/`, never embedded
as base64 in JSON. `contentHash` is a SHA-256 of the exact file bytes (verified against
the actual file in the quality-gate inspection below). `animations: "disabled"` is the
documented default for determinism.

DOM snapshots are sanitized by `sanitizeDomSnapshot` (`src/core/dom-sanitizer.ts`) — a
deterministic, dependency-free, regex-based pass (not a full HTML parser, intentionally
conservative: better to over-remove than under-remove):

- Removed and counted: `<script>`, `<style>`, `<iframe>` blocks (→ `scriptsRemoved`);
  `<input>` `value` attributes, `<textarea>` contents, entire hidden `<input
  type="hidden">` elements, and token/CSRF-looking `<meta>` tags (→
  `sensitiveFieldsRedacted`); HTML comments (→ `commentsRemoved`).
- Always stripped but not separately counted: inline event-handler attributes
  (`onclick`, `onload`, ...) and `nonce`/`integrity` attributes.
- Local/session storage content is never read by the DOM snapshot capture path in the
  first place, so there is nothing to strip.

## Network policy

Every request is intercepted (`context.route`), classified as `first-party` or
`third-party` against the target's origin, and either `allowed` or `blocked` per policy
(`blockThirdPartyRequests`, `blockedResourceTypes`, `blockedUrlPatterns`). **Never
persisted, under any circumstance**: `Authorization`/`Cookie`/`Set-Cookie` headers, API
keys, tokens, request/form bodies, passwords, or local/session storage — these are
simply never read, not merely redacted. URLs are sanitized (`sanitizeUrl`) to redact a
documented, configurable list of sensitive query-parameter names (`token`,
`access_token`, `api_key`, `key`, `secret`, `password`, `code`, `session`, `auth`) and to
strip any embedded credentials. HAR export is explicitly out of scope for this RFC.

## Sensitive-data policy

`FillStep.value` is never written to any artifact, decision, event log, console record,
or screenshot text beyond the value actually rendered by the real page (which is the
application's own behavior, not something DPS adds). `value-equals` assertions against
a field marked `sensitive` have their `actual`/`expected` redacted in the stored
`BrowserAssertionResult`. A dedicated `sensitive-value-exposure` safety-violation kind
exists in the type system as a hook for a future detector; the reference implementation
does not yet perform content-based sensitive-value scanning (see Limitations).

## Observation generation

`BrowserCaptureEngine` generates a `DemoObservationTimeline` deterministically from the
finalized step results, evaluated assertions, and screenshots — **never** from
transcript-like narrative text, and never by "AI" interpretation of page content. The
rules (implemented in `generateObservations`, `src/engines/browser-capture.ts`):

- A **completed click step** → `interaction-start`.
- A **passed `element-visible` assertion before any click** → `product-ui-visible`.
- The **first passed assertion after a click** → `interaction-complete`; any further
  passed assertions after that same click (before the next one) → `state-change`.
- A passed post-click assertion whose step is marked `importance: "critical"` → an
  **additional** `result-visible` observation (on top of `interaction-complete`/
  `state-change`) — this ties "the result" to explicit plan-author intent rather than
  inferred semantics.
- A **screenshot step immediately following a passed post-click assertion** (previous
  step in plan order) → `proof-visible`. **A screenshot alone, with no immediately
  preceding passed assertion, never becomes `proof-visible`** — it is classified
  `before-state` (if before any click) or `after-state` (otherwise) instead. This is the
  concrete enforcement of Core Principle 5 ("a screenshot is evidence that pixels were
  captured, not necessarily that a product claim is true").

Every generated observation carries `sourceType: "capture"`, `verificationStatus:
"verified"` (because these are drawn from real, mechanically-observed execution), a
`relatedEvidenceIds` array referencing only real step/assertion/screenshot IDs, and
`startSeconds`/`endSeconds` derived from elapsed capture time (never wall-clock
timestamps). Observation IDs are deterministic within a plan (`obs-<kind>-<n>`, assigned
in step order).

## Evidence coverage

For each `BrowserEvidenceRequirement`, `evaluateRequirement` checks: every declared
`requiredArtifactKinds` condition (screenshot/DOM-snapshot existence, `url` capture,
`requiredAssertionIds` all passed), and that the capture's total verified-artifact count
meets `minimumVerifiedArtifacts`. **Limitation**: `minimumVerifiedArtifacts` is checked
against the capture's total verified-artifact count, not scoped specifically to this
requirement's own artifacts — a simplification documented here rather than hidden.
`BrowserEvidenceCoverage.coverageRatio` and `sufficient` are computed the same way as
RFC-0002/0003's coverage models, for consistency across the codebase.

## Capture Gate

```text
gate:
  name: "browser-capture"
  status: pass | conditional | fail
  blockingReasons: string[]
  warnings: string[]
  requirementsBeforeUse: string[]
```

**FAIL** when: the browser failed to launch; a blocking safety violation occurred
(`origin-disallowed`, `external-navigation-blocked`, `sensitive-value-exposure` —
popup/download blocks that worked as intended are NOT failures); any `importance:
"critical"` assertion did not pass; a blocking step failed or timed out; any critical
evidence requirement is unsatisfied; the capture reached `maximumDurationMs`; or no
*meaningful* verified evidence artifact exists (a bare final URL alone never counts —
see below).

**CONDITIONAL** when structurally sound but: a non-critical evidence requirement is
unmet, a non-blocking step failed, a non-critical assertion failed, the target is
`explicit-remote` (flagged for manual review), or non-blocking safety events occurred.

**PASS** otherwise.

A subtlety fixed during implementation and covered by
`tests/browser-capture-engine.test.ts`: reaching *some* URL is not meaningful evidence
by itself (nearly every successful navigation produces one), so the "no verified
evidence generated" FAIL condition and the "at least one verified evidence artifact
exists" PASS requirement both use a count that **excludes** the bare `url` evidence
kind — only screenshots, DOM snapshots, and passed assertions count as meaningful
verified evidence.

## ProductUnderstanding bridge

`bridgeBrowserCaptureToUnderstanding(plan, result, runId)` deterministically converts
**only verified** capture evidence into RFC-0002-shaped `EvidenceItem`s: every passed
assertion, every screenshot/DOM-snapshot artifact (phrased as "pixels captured" /
"snapshot captured", never as a proven business claim), and every *satisfied*
`BrowserEvidenceRequirement` (using the requirement's own declared `claim` and
`importance`). Failed/errored assertions and unsatisfied requirements are never
bridged. This is a one-way, read-only function — it never mutates or rewrites an
existing `ProductUnderstanding` artifact; its output (`understanding-evidence.json`) is
a separate artifact for a future orchestration step to consume, establishing the path
for the Understanding Gate to eventually reach `pass` once real verified evidence
exists.

## CLI usage

```bash
npm run capture-browser -- <path-to-capture.yaml>
```

The YAML *is* a `BrowserCapturePlan` directly (see
`examples/browser-capture/capture.yaml`). Behavior:

- Missing argument → usage message, exit 1, no run directory.
- Schema-invalid or semantically-invalid plan (per `validateCapturePlan`) → errors
  printed, exit 1, no run directory.
- Otherwise the pipeline always runs to completion and writes, under
  `.dps/runs/<run-id>/`: `capture-plan.json`, `browser-execution.json`,
  `browser-step-results.json`, `browser-assertions.json`, `browser-network.json`,
  `screenshots/*.png`, `dom/*.html` (when a `dom-snapshot` step is present),
  `browser-observations.json`, `browser-evidence-manifest.json`,
  `browser-capture-result.json`, `understanding-evidence.json`, `decisions.json`,
  `events.json`, `run-summary.json`.
- Exit code 0 for a `pass`/`conditional` gate; exit code 1 for a pipeline exception or a
  `fail` gate (`src/cli/exit-code-policy.ts`, shared with `analyze-demo`).
- Prints the run directory, gate status, steps completed/failed, assertions
  passed/failed, and evidence coverage ratio — never full DOM snapshots, header/cookie
  values, or fill values.
- Browser resources are always closed (`finally` blocks in the adapter), even when the
  CLI itself fails.

## Offline example

`examples/browser-capture/` — a tiny, fully static, offline fixture page (product
title, problem statement, state card, "Verify Receipt" button, result card) served by a
minimal dependency-free static file server (`fixture-server.mjs`, binds to
`127.0.0.1` only). The shipped `capture.yaml` produces a fully verified sequence:
`product-ui-visible` → `before-state` → `interaction-start` → `interaction-complete` +
`result-visible` → `proof-visible`, with the Capture Gate resolving to `pass`. See
`examples/browser-capture/README.md` for exact run instructions (the fixture server
must be started first, in a separate terminal, since a static asset server is not
itself something `capture-browser` manages).

## Limitations

- `minimumVerifiedArtifacts` is checked globally, not scoped per-requirement (see
  Evidence coverage above).
- No content-based sensitive-value detector exists yet; `sensitive-value-exposure` is a
  defined safety-violation kind with no automatic producer in this reference
  implementation — sensitivity must be declared explicitly on steps/fields today.
- The DOM sanitizer is a conservative regex-based pass, not a full HTML/DOM parser; it
  is deliberately biased toward over-removal.
- `screenshot-created` assertions check only whether *any* screenshot has been captured
  so far in the run, not a specific named screenshot.
- Observation generation rules are fixed and plan-structure-dependent (e.g. "the
  passed assertion immediately preceding a screenshot"); they do not attempt any deeper
  semantic linkage.
- No video or trace recording, no visual diffing, no accessibility-tree analysis.

## Future extension points (not implemented here)

- Browser exploration agent (autonomous, AI-driven interaction planning).
- Authenticated session adapter (login flows, session storage handling).
- Visual comparison / screenshot diffing.
- OCR adapter for on-screen text extraction.
- Accessibility-tree analysis adapter.
- Mobile device emulation profiles beyond basic `isMobile`/viewport.
- Video recording and Playwright trace recording.
- Remote/cloud browser provider adapters (implementing the same `BrowserAdapter`
  interface).
