# Demo Production System

> A demo is not a recording of a product. It is the construction of understanding.

Demo Production System (working name: **DPS**) is an evidence-first, configuration-driven framework for turning a software product into a reproducible product demonstration.

## Current status

**Sprint 1 — Foundation**

This repository currently defines the smallest executable core:

- canonical domain types;
- engine contracts;
- artifact envelope and registry;
- decision log;
- event bus;
- Demo Intermediate Representation (DIR);
- initial `demo.yaml` schema;
- contract tests.

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
  core/
    artifacts/
    decisions/
    engines/
    events/
    dir/
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

## First implementation milestone

The first vertical slice will accept a validated project manifest and produce:

```text
demo.yaml
  -> understanding artifact
  -> plan artifact
  -> DIR
  -> deterministic JSON output
```

Rendering and browser capture are deliberately deferred until this foundation passes its contract tests.

## Naming

`Demo Production System` and `DPS` are provisional names and must pass the project's Naming & Distinction Gate before public launch.
