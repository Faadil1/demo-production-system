# Demo Production System

> A demo is not a recording of a product. It is the construction of understanding.

Demo Production System (working name: **DPS**) is an evidence-first, configuration-driven framework for turning a software product into a reproducible product demonstration.

## Current status

**RFC-0001 â€” Foundation Vertical Slice: implemented**
**RFC-0002 â€” Product Understanding Contract: implemented**
**RFC-0003 â€” Existing Demo Analysis: implemented**
**RFC-0004 â€” Browser Evidence Capture: reference implementation complete, extension adapters pending**
**RFC-0005 â€” Story Engine & Storyboard Compiler: implemented and independently validated**
**RFC-0006 â€” Renderer-Neutral Render Planning & Technical Render Gate: implemented and independently validated**

The repository now runs an end-to-end, deterministic, provider-independent pipeline across understanding, evidence capture, and render planning:

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

Storyboard (via npm run compile-story)
  -> reference Story Engine (RFC-0005, see docs/007)
  -> storyboard.json with narrative structure, proof chains, renderer readiness
  -> Story Gate (pass/conditional/fail)

RenderPlan (via npm run compile-render)
  -> reference Render Planning Engine (RFC-0006, see docs/008)
  -> render-plan.json with frame boundaries, asset bindings, objective layout
  -> Render Gate (technical, pre-render)
  -> [pending: renderer adapter to produce MP4]
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
locally â€” no computer vision, speech recognition, or LLM involved:

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
`pass`/`conditional`/`fail` Capture Gate â€” a screenshot alone is never treated as proof;
only a passed assertion linked to a screenshot becomes `proof-visible`. A one-way
bridge converts verified capture evidence into RFC-0002-shaped evidence
(`understanding-evidence.json`) without ever rewriting an existing `ProductUnderstanding`
artifact. See
[`docs/006-browser-evidence-capture.md`](docs/006-browser-evidence-capture.md) for the
full contract, safety model, and CLI usage (the example requires starting a local
fixture server first â€” see `examples/browser-capture/README.md`).

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
              # story/render/media/transcript/observation contracts,
              # browser target/plan/policy/assertion/network/artifact/evidence contracts
  engines/    # deterministic reference Understanding + Planning + Story + Render engines,
              # DIR/ExistingDemoAnalysis/BrowserCapture engines
  adapters/   # replaceable MediaInspector (ffprobe) and BrowserAdapter (Playwright) interfaces
  bridges/    # one-way browser-capture -> ProductUnderstanding evidence bridge
  registry/   # filesystem ArtifactRegistry implementation
  cli/        # demo, analyze-demo, capture-browser, compile-story, compile-render entrypoints
schemas/      # JSON Schema definitions for all artifact types
docs/         # RFC specifications and implementation documentation
tests/        # comprehensive test suite (301+ tests)
examples/     # minimal examples for each pipeline stage
```

## Quick start

```bash
npm install
npm run typecheck
npm test
```

## Next milestone

With RFC-0001 through RFC-0006 complete, the individual pipeline stages produce valid
artifacts independently. The next milestone (RFC-0007) addresses the practical gap:
individual CLI commands (`demo`, `compile-story`, `compile-render`) currently require
callers to manually assemble inline payload bundles. RFC-0007 introduces artifact resolution
against the filesystem registry and deterministic pipeline orchestration, enabling
fully reproducible end-to-end runs without manual artifact copying.

After RFC-0007, the following milestone (RFC-0008 or renderer-adapter work) will
introduce a Remotion renderer adapter and MP4 export, completing the output pipeline.
Rendering remains deliberately excluded from the core (RFC-0006) and will be an
adapter responsibility.

## Naming

`Demo Production System` and `DPS` are provisional names and must pass the project's Naming & Distinction Gate before public launch.
