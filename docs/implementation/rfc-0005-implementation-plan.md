# RFC-0005 implementation plan

This is the Phase 1 repository-inspection output for the RFC-0005 (Story Engine &
Storyboard Compiler) implementation. It records the conventions the implementation
follows and the scope decisions made before writing any code.

## Conventions observed in RFC-0002–0004

- Contracts live in `src/core/<name>.ts` as plain `readonly`-field TypeScript types, one
  file per artifact family, with a `schemaVersion` literal field.
- Engines live in `src/engines/<name>.ts`, implement `Engine<I, O>` from
  `src/core/engine.ts` (`validate`/`run`/`verify`/`metrics`, plus a
  `decisionsFromLastRun()` escape hatch consumed by the CLI's `DecisionLog`).
- Engines are pure aside from `context.now()`/`context.runId`, which affect only
  timestamp/id metadata, never semantic output.
- `DecisionRecord` (`src/core/decision.ts`) is the shared decision-audit shape; the CLI
  writes it via `DecisionLog` to `decisions.json`.
- CLI commands (`src/cli/*.ts`) read input, construct a run directory under
  `.dps/runs/<runId>/`, write an `ArtifactEnvelope` per artifact via
  `FilesystemArtifactRegistry`, publish `EventLog` events, and finish with a
  `run-summary.json`. A failed *gate* is always persisted (never thrown); only a genuine
  pipeline exception aborts the run. Exit codes come from the shared
  `determineExitCode()` policy.
- Determinism is achieved via `stableStringify`/`contentHashOf` (`src/core/stable-json.ts`,
  `src/core/hash.ts`) — sorted object keys, explicit array sorts, no `Map`/`Set`
  iteration-order dependence.
- Tests use `vitest`, construct fixtures inline via small builder functions (see
  `tests/existing-demo-analysis.test.ts`), and run engines directly against a fixed
  `EngineContext` (`{ runId: "run-test", now: () => new Date(...) }`).

RFC-0005 follows every one of these conventions: `src/core/story.ts`,
`src/engines/story.ts`, `src/cli/compile-story.ts`, `tests/story-engine.test.ts`.

## Scope decision for the reference compiler

RFC-0005 (docs/007) specifies a very large surface (arc catalog, multi-dimensional
candidate scoring, per-claim assertion linkage, full duration-compression search). The
RFC itself flags its §20 scoring formula as "illustrative, not final" and leaves several
mechanisms as implementation details ("exact scoring weights ... do not change the
contracts or invariants defined here").

The reference implementation therefore:

- Implements **every contract type** in §6–§27 (`NarrativeBeat`, `StoryEvidenceReference`,
  `StoryScene`, `StorySequence`, `Storyboard`, `HeroInteractionSequence`, `ProofChain`,
  `RendererReadiness`, `StoryGate`, `StoryCoverage`, `StoryMetrics`,
  `BrowserCaptureSelectionPolicy`, `StoryConstraint`, `StoryCompilerInput`) with the exact
  field shapes from the RFC's DRAFT CONTRACT blocks.
- Implements the **full pipeline shape** from §19/§28 (normalize → candidates → arc
  selection → scenes → sequences → proof chains → duration → coverage → renderer
  readiness → gate → decisions).
- Implements a **documented, simplified candidate-generation policy**: one scene per
  selected beat (rather than a multi-candidate-per-slot scoring competition), and
  run-level (rather than per-claim-text) matching between a DIR-required claim and
  browser assertion evidence, because `BrowserAssertionResult` carries no claim-id field
  to match against.
- Implements the ten accepted contract rules from the task brief as enforceable
  invariants and covers each with a dedicated test (see
  `docs/implementation/rfc-0005-implementation.md` § "Contract rule coverage").

This is documented, not silent: every simplification is called out both in code comments
(`src/engines/story.ts` file header) and in the implementation doc's Known Limitations
section, per the task's Phase 18 requirement.

## Non-goals honored

No Remotion rendering, MP4 export, video encoding, voice generation, caption rendering,
visual-quality scoring, multi-variant storyboard generation, second Story Gate, Render
Gate, external AI calls, remote services, or browser capture logic was added. The
compiler consumes already-produced `BrowserCaptureResult` values; it never launches a
browser itself.
