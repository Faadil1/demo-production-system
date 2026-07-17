# Browser Evidence Capture example (RFC-0004)

Demonstrates `npm run capture-browser` — a deterministic, local-only Playwright
capture that produces verified evidence from a real browser session, described in
[`docs/006-browser-evidence-capture.md`](../../docs/006-browser-evidence-capture.md).

## Files

- `fixture/index.html`, `fixture/style.css`, `fixture/script.js` — a tiny, fully
  offline static page: a product title, a problem statement, a state card, a "Verify
  Receipt" button, and a result card that becomes visible after the button is clicked.
  No randomness, no timestamps, no external resources, no analytics, no network
  dependencies.
- `fixture-server.mjs` — a minimal, dependency-free static file server (binds to
  `127.0.0.1` only) that serves `fixture/` on port `4173`.
- `capture.yaml` — the `BrowserCapturePlan`: navigate → assert product visible →
  screenshot (before) → click "Verify Receipt" → assert result visible (critical) →
  screenshot (after), plus one evidence requirement tied to the critical assertion.

No generated screenshots or HTML snapshots are committed — they are written fresh to
`.dps/runs/<run-id>/` on every run.

## Running it

This example requires two things running:

1. The local fixture server (must be started first, in its own terminal):

   ```bash
   node examples/browser-capture/fixture-server.mjs
   ```

2. The capture, in a second terminal:

   ```bash
   npm run capture-browser -- examples/browser-capture/capture.yaml
   ```

   Requires Playwright's Chromium browser to be installed. If it is not:

   ```bash
   npx playwright install chromium
   ```

## Expected result

With the fixture server running, the capture plan produces a fully verified Hero
Interaction-equivalent sequence:

- `assert-product-visible` passes → a `product-ui-visible` observation.
- `screenshot-before` → a `before-state` observation.
- `click-verify` completes → an `interaction-start` observation.
- `assert-result-visible` passes (critical) → `interaction-complete` **and**
  `result-visible` observations.
- `screenshot-after` (immediately follows the passed critical assertion) →
  a `proof-visible` observation.

The evidence requirement is satisfied, at least one verified artifact exists, and the
capture stays within the `local` origin the whole time, so the **Capture Gate resolves
to `pass`**.

## Inspecting output

Artifacts are written to `.dps/runs/<run-id>/`:

- `capture-plan.json`
- `browser-execution.json`
- `browser-step-results.json`
- `browser-assertions.json`
- `browser-network.json`
- `screenshots/before-state.png`, `screenshots/after-state.png`
- `browser-observations.json`
- `browser-evidence-manifest.json`
- `browser-capture-result.json`
- `understanding-evidence.json`
- `decisions.json`
- `events.json`
- `run-summary.json`
