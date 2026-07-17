# Demo Production System

> A demo is not a recording of a product. It is the construction of understanding.

Demo Production System (working name: **DPS**) is an evidence-first, configuration-driven framework for turning a software product into a reproducible product demonstration.

## Current status

**RFC-0001 — Foundation Vertical Slice: implemented**
**RFC-0002 — Product Understanding Contract: implemented**

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

No browser automation, AI provider, renderer, or generated media is part of the core.

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
  core/       # domain types, engine contract, artifact/decision/event contracts, DIR type
  engines/    # deterministic reference Understanding + Planning engines, DIR compiler
  registry/   # filesystem ArtifactRegistry implementation
  cli/        # demo pipeline entrypoint (npm run demo)
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

With RFC-0001 and RFC-0002 complete, the next milestone (v0.2) introduces the Story
Engine, browser capture adapter, and renderer adapter behind the same core contracts.
A capture adapter is also the prerequisite for the Understanding Gate ever reaching
`pass` (see docs/004's Current limitations). Rendering and browser capture remain
deliberately excluded from the core itself.

## Naming

`Demo Production System` and `DPS` are provisional names and must pass the project's Naming & Distinction Gate before public launch.
