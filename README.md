# Demo Production System

> A demo is not a recording of a product. It is the construction of understanding.

Demo Production System (working name: **DPS**) is an evidence-first, configuration-driven framework for turning a software product into a reproducible product demonstration.

## Current status

**RFC-0001 — Foundation Vertical Slice: implemented**
**RFC-0002 — Product Understanding Contract: implemented**
**RFC-0003 — Existing Demo Analysis: implemented**
**RFC-0004 — Browser Evidence Capture: reference implementation complete, extension adapters pending**

The repository now runs an end-to-end, deterministic, provider-independent pipeline:

```text
demo.yaml
  -> manifest loading + JSON Schema validation
  -> reference Understanding Engine (Product Understanding contract, see docs/004)
  -> reference Planning Engine
  -> DIR compilation (with explicit readiness state)
  -> filesystem Artifact Registry
  -> Decision Log
  -> lifecycle Event Log
  -> run-summary.json
```

The Understanding Engine now produces a structured `ProductUnderstanding` artifact that
separates observed facts, human-supplied claims, inferred hypotheses, evidence
candidates, missing evidence, Hero Interaction candidates, ambiguities, risks,
confidence, and human-approval requirements, gated by an explicit
`pass`/`conditional`/`fail` Understanding Gate. See
[`docs/004-product-understanding-contract.md`](docs/004-product-understanding-contract.md)
for the full contract.

Run it with:

```bash
npm run demo -- examples/minimal/demo.yaml
```

Artifacts are written to `.dps/runs/<run-id>/`: `manifest.json`, `understanding.json`,
`plan.json`, `dir.json`, `decisions.json`, `events.json`, `run-summary.json`.

A second, independent pipeline analyzes an *existing* demo video deterministically and
locally — no computer vision, speech recognition, or LLM involved:

```bash
npm run analyze-demo -- examples/existing-demo/analysis.yaml
```

It inspects local media with `ffprobe`, consumes an optional transcript and/or
human-supplied observation timeline, and produces an `existing-demo-analysis.json`
artifact with a Hero Interaction detection, a 100-point explainable Demo Score, and a
`pass`/`conditional`/`fail` Analysis Gate. See
[`docs/005-existing-demo-analysis.md`](docs/005-existing-demo-analysis.md) for the full
contract.

A third pipeline lets DPS create its **own** verified evidence by executing a
deterministic browser capture plan (Playwright Chromium) against a local or explicitly
allowlisted web application:

```bash
npm run capture-browser -- examples/browser-capture/capture.yaml
```

It runs an explicit, safety-policy-bounded sequence of navigate/click/assert/screenshot
steps, generates a browser-driven `DemoObservationTimeline`, and produces a
`browser-capture-result.json` with an evidence manifest and a
`pass`/`conditional`/`fail` Capture Gate — a screenshot alone is never treated as proof;
only a passed assertion linked to a screenshot becomes `proof-visible`. A one-way
bridge converts verified capture evidence into RFC-0002-shaped evidence
(`understanding-evidence.json`) without ever rewriting an existing `ProductUnderstanding`
artifact. See
[`docs/006-browser-evidence-capture.md`](docs/006-browser-evidence-capture.md) for the
full contract, safety model, and CLI usage (the example requires starting a local
fixture server first — see `examples/browser-capture/README.md`).

No Remotion rendering, LLM, OCR, speech-to-text, or cloud API is part of the core.

## Principles

1. Understanding before rendering.
2. Evidence before effects.
3. Story before timeline.
4. Engines before tools.
5. Configuration before prompting.
6. Human authority over critical creative decisions.
7. Every important decision is explainable.
8. Every export is reproducible.

## Repository layout

```text
src/
  core/       # domain types, engine contract, artifact/decision/event contracts, DIR type,
              # media/transcript/observation/existing-demo-analysis contracts,
              # browser target/plan/policy/assertion/network/artifact/evidence contracts
  engines/    # deterministic reference Understanding + Planning engines, DIR compiler,
              # ExistingDemoAnalysisEngine, BrowserCaptureEngine
  adapters/   # replaceable MediaInspector (ffprobe) and BrowserAdapter (Playwright) interfaces + reference implementations
  bridges/    # one-way browser-capture -> ProductUnderstanding evidence bridge
  registry/   # filesystem ArtifactRegistry implementation
  cli/        # demo, analyze-demo, and capture-browser pipeline entrypoints
schemas/
docs/
tests/
examples/
```

## Quick start

```bash
npm install
npm run typecheck
npm test
```

## Next milestone

With RFC-0001 through RFC-0004 complete, the next milestone (v0.2) introduces the Story
Engine and a renderer adapter behind the same core contracts, plus wiring the RFC-0004
browser-capture bridge into an actual Understanding Gate re-evaluation and into
RFC-0003's Existing Demo Analysis observation input — both of which can now be fed real
verified evidence instead of only externally-supplied data. Rendering remains
deliberately excluded from the core itself.

## Naming

`Demo Production System` and `DPS` are provisional names and must pass the project's Naming & Distinction Gate before public launch.
