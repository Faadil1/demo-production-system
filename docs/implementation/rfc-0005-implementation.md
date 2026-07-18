# RFC-0005 implementation — Story Engine & Storyboard Compiler

Status: **Reference implementation with explicitly documented limitations.** An
independent conformance audit (see `docs/implementation/rfc-0005-conformance-audit.md`)
found and corrected two RFC non-conformities (proof-chain over-claiming across DIR
evidence kinds a browser run cannot substantiate, and a §7 `sourceClaimIds`/
`sourceFactIds` invariant violation on Hero-Interaction-derived beats), added
`schemas/storyboard.schema.json` to match the RFC-0002–0004 schema convention, switched
the CLI to accept YAML per §32, and added test coverage for renderer readiness, CTA
policy, arc override, rejection-code validity, and the corrected proof-chain behavior.
The remaining items below are genuine, intentionally scoped v0.1 limitations (narrow
candidate-generation surface, simplified duration compression, run-level rather than
semantically-matched proof linkage) — none of them violates an RFC-0005 invariant, but
several genuinely narrow which of the eight `NarrativeArc`s and which of the nineteen
`NarrativeBeatKind`s the reference compiler can actually reach without an `arc-override`
constraint. See "Known limitations" below for the precise, honest boundary.

## Architecture

```
StoryCompilerInput
  │  (ProductUnderstanding + DIR + ExistingDemoAnalysis? + BrowserCaptureRunInput[])
  ▼
StoryEngine.run()                              src/engines/story.ts
  1. resolve storyMode (§26)
  2. select authoritative capture run (BrowserCaptureSelectionPolicy, §26)
  3. resolve Hero Interaction authority + verification (§16)
  4. generate candidate NarrativeBeats + rejectedCandidates (§19 step 6-7)
  5. select NarrativeArc (§15) — override-aware
  6. build StoryScenes + StorySequences (§9, §12) — exclusive beat/scene ownership
  7. build ProofChains (§17)
  8. allocate StoryDurationBudget (§18)
  9. compute StoryCoverage (§23) + RendererReadiness (§9a/§25)
  10. compute the single StoryGate (§25)
  11. compute StoryMetrics (§24)
  ▼
Storyboard                                     src/core/story.ts
```

- **Contracts**: `src/core/story.ts`. All RFC-0005 §6–§27 DRAFT CONTRACT types are
  implemented verbatim as TypeScript types (`NarrativeBeat`, `StoryEvidenceReference`,
  `StoryScene`, `StorySequence`, `Storyboard`, `HeroInteractionSequence`, `ProofChain`,
  `RendererReadiness`, `StoryGate`, `StoryCoverage`, `StoryMetrics`,
  `BrowserCaptureSelectionPolicy`, `StoryConstraint`, `StoryCompilerInput`), plus the
  `NARRATIVE_ARCS` closed reference set (§15) and evidence-eligibility helper
  `isEvidenceEligibleForRole()` (§8).
- **Engine**: `src/engines/story.ts`, `StoryEngine implements Engine<StoryCompilerInput,
  Storyboard>` — same shape as `UnderstandingEngine`/`ExistingDemoAnalysisEngine`/
  `BrowserCaptureEngine`.
- **CLI**: `src/cli/compile-story.ts`, `npm run compile-story -- <path-to-story-input.yaml>`
  (per §32; `.json` is also accepted — file extension selects the parser). Reads a
  `StoryCompilerInput` document, runs the engine, persists `storyboard.json` via the
  existing `FilesystemArtifactRegistry`/`DecisionLog`/`EventLog`/`run-summary.json`
  machinery (matching `analyze-demo.ts`/`capture-browser.ts` exactly). A failed Story Gate
  is always persisted; the CLI's exit code (via the shared `determineExitCode()` policy)
  is the only thing that reflects gate failure.
- **Schema**: `schemas/storyboard.schema.json` — a shallow, top-level-required-fields
  JSON Schema for `Storyboard`, matching the depth convention already used by
  `schemas/existing-demo-analysis.schema.json` (added by this audit; RFC-0005 had
  shipped with no schema file, unlike RFC-0002–0004).

## Contract rule coverage (the ten accepted contract rules)

| # | Rule | Where enforced | Test |
|---|---|---|---|
| 1 | `storyMode` required, no inference | `resolveStoryMode()` — `"mode"` constraint or default `"promotional"` | "resolves diagnostic mode only from an explicit constraint..." |
| 2 | No silent duration default | `StoryEngine.run()` duration validity check → `gate.status: "fail"`, empty `Storyboard` | "never silently defaults a missing/invalid duration" |
| 3 | `evidenceRefIds` canonical | `ProofChain.evidenceRefIds` always populated from `StoryEvidenceReference` ids; `sourceAssertionIds`/`sourceArtifactIds` retained separately | type-level (`buildProofChains`) |
| 4 | Browser-specific fields stay provenance-only | `StoryEvidenceReference.sourceRunId`/`sourceArtifactId`/`sourceItemId` always carried through from the originating `DemoObservation`/`BrowserAssertionResult` | "capture-run-selected" decision + evidence refs |
| 5 | One canonical Storyboard per compilation | `StoryEngine.run()` returns exactly one `Storyboard`; no ranking/variants | structural |
| 6 | Exclusive beat ownership | one scene per beat (`beatIds: [beat.id]`) by construction | "Beat ownership" assertion in the promotional test |
| 7 | Exclusive scene ownership | each scene assigned to exactly one `StorySequenceKind` bucket | "Scene ownership" assertion in the promotional test |
| 8 | `RendererReadiness` feeds the single Story Gate, not a second gate | `computeGate()` takes `rendererReadiness` as an input parameter; no separate gate type exists | type-level (`StoryGate` has no readiness sub-status) |
| 9 | Hero narrative authority vs. technical demonstrability are separate dimensions | `resolveHeroInteraction()` keeps `sourceHeroInteractionId`/`narrativeAuthority` fixed by RFC-0002 human selection while `verificationStatus`/`continuityStatus` vary independently with capture evidence | "preserves human Hero Interaction authority even when browser evidence cannot verify it" |
| 10 | `BrowserCaptureSelectionPolicy` — array order never authoritative | `selectAuthoritativeCapture()` never reads array position; sorts by `capturedAt`/`gate.status`/`runId` only | "honors an explicit authoritativeRunId over recency", "rejects compilation as an unresolved conflict..." |

## Determinism guarantees

- `Storyboard.id` is `contentHashOf(...)` over `sourceArtifactIds` + `schemaVersion` +
  `objective` + `storyMode` + `duration` + `constraints` — stable across repeated
  compilations of identical input regardless of `runId`/wall-clock time (test: "produces a
  stable Storyboard.id across repeated compilations").
- Beat/scene/sequence ids are fixed slugs derived from beat *kind* (e.g. `beat-problem`,
  `scene-proof`, `sequence-outcome`), not counters or random UUIDs.
- All arrays the compiler builds from unordered upstream collections (`facts`,
  `hypotheses`, `heroInteractionCandidates`, `assertions`, `browserCaptures`) are sorted
  by a stable key (`id`/`assertionId`/`runId`, lexical `localeCompare`) before use.
- The determinism test (`tests/story-engine.test.ts`, describe block "§29") reverses
  `facts`, `hypotheses`, and `browserCaptures` array order and confirms the canonical
  `Storyboard` (with `createdAt`/`decisionId`/`runId` stripped from decisions, per §29's
  documented timestamp exclusion) is byte-identical via `stableStringify`, while
  `scenes`/`sequences` ordering — which the RFC requires to be contractually fixed by
  `order` — is asserted separately to remain stable.

## CLI usage

```
npm run compile-story -- path/to/story-input.yaml
npm run compile-story -- path/to/story-input.json   # also accepted
```

`story-input.yaml`/`.json` is a `StoryCompilerInput` document (see `src/core/story.ts`
for the exact shape): `productUnderstanding`, `dir`, optional `existingDemoAnalysis`,
`browserCaptures` (each wrapped with `runId`/`artifactId`/`capturedAt`, since
`BrowserCaptureResult` itself does not carry that run identity — see Known Limitations),
`objective`, required `duration`, and `constraints`.

Output: `.dps/runs/<runId>/storyboard.json` (the full `Storyboard`, via
`ArtifactEnvelope`), `decisions.json`, `events.json`, `run-summary.json`.

## Artifact format

Matches the existing single-file-per-artifact-family convention (RFC-0004's
`BrowserCaptureResult` embeds its own gate rather than a standalone file) — `Storyboard`
embeds `StoryGate`, `StoryCoverage`, `RendererReadiness`, and `StoryMetrics` as fields
rather than separate artifact files, per §31's explicitly-permitted embedding option.

## Gate behavior

`StoryGate.status` is computed by `computeGate()` in `src/engines/story.ts`. FAIL
conditions implemented: invalid/missing duration, zero scenes, `UnderstandingGate: fail`
in promotional mode, a critical claim without a verified `ProofChain`, a broken Hero
Interaction, over-budget duration after allocation, an unresolved capture conflict under
`"reject-conflict"`, and a renderer-blocked critical scene. Any of these alone produces
`fail`; absent all of them, an unresolved warning (non-critical coverage gap, recapture
requirement, admitted unverified-impact beat, applied compression) produces `conditional`;
otherwise `pass`.

## Known limitations (honest, not hidden)

These are simplifications relative to the full RFC-0005 §19/§20 specification, made to
keep the reference compiler a genuinely deterministic, testable pure function within
scope, and documented per the task's Phase 18 requirement:

1. **One scene per selected beat**, not the full multi-candidate §20 scoring
   competition (criticality/verification/importance/heroRelevance/... weighted score).
   The RFC itself calls its formula "illustrative, not final."
2. **Run-level, not per-claim, proof-chain eligibility — narrowed, but not eliminated,
   by this audit.** `BrowserAssertionResult` (RFC-0004, `src/core/browser-assertion.ts`)
   carries no claim-id field, and `DemoIntermediateRepresentation.EvidenceReference`
   (`src/core/dir.ts`) carries no assertion-id field either — there is genuinely no
   upstream identifier connecting a specific passed assertion to a specific DIR claim.
   This is an **upstream contract gap** (RFC-0004/DIR, not something RFC-0005 can fix by
   itself without either RFC-0004 growing a new field or DIR growing one). Fixing it
   fully requires an owner decision on which RFC gains the linking field.
   Pending that decision, this audit narrowed the blast radius of the missing linkage:
   `buildProofChains()` in `src/engines/story.ts` now only allows DIR evidence entries of
   `kind: "capture"` or `kind: "state-change"` — the kinds a browser run can plausibly
   substantiate at all — to be marked `"verified"`/`"partial"` from browser evidence;
   `"document"`/`"log"`/`"receipt"`/`"metric"`/`"recording"` claims are always
   `"unsupported"` from browser evidence (with an explanatory `gaps` entry), since no
   browser assertion could ever legitimately prove them. Before this fix, *any* passed
   assertion in the authoritative run marked *every* DIR evidence entry — including
   unrelated document/compliance claims — as `"verified"`, which was a genuine over-claim
   bug, not just a granularity simplification. Within the same fix, Hero-Interaction-
   derived beats (`interaction-start`/`interaction-complete`/`proof`/`result`) now
   populate `sourceClaimIds` with the browser-substantiable DIR evidence ids they
   evidence, satisfying the §7 invariant that was previously violated (those beats had
   `sourceClaimIds: []`, `sourceFactIds: []` with non-empty `evidenceRefs`, which §7
   explicitly prohibits for these beat kinds).
   True per-claim (not just per-kind) precision still requires the missing upstream
   identifier and remains an owner decision.
3. **Capture-run conflict detection** is based on `(capturePlanId, targetId)` gate-status
   disagreement across runs, not a genuine per-claim disagreement (again because no
   per-claim id exists on `BrowserCaptureResult`).
4. **Candidate beat generation covers 9 of 19 `NarrativeBeatKind`s** (problem,
   product-introduction, interaction-start, interaction-complete, proof, result,
   limitation, call-to-action, impact). Never generated: `hook`, `audience-context`,
   `consequence`, `current-state`, `goal`, `mechanism`, `interaction-progress`,
   `comparison`, `trust`, `next-step`. This has a real, non-cosmetic consequence beyond
   "fewer optional beats appear": §15's arc-selection procedure scores each of the eight
   `NarrativeArc`s by how many of its *required* beats have an eligible candidate, and
   four arcs (`before-interaction-after`, `goal-obstacle-resolution`,
   `diagnosis-intervention-result`, `comparison-decision`) require at least one of
   `current-state`/`goal`/`mechanism`/`comparison` — kinds this compiler can never
   generate as a candidate. Those arcs can therefore never be reached by the ordinary
   (non-`arc-override`) selection procedure; `problem-solution-proof` (or, for the
   `impact`-requiring case, whichever arc scores highest among the reachable subset) is
   effectively the only arc the automatic selector can choose. §27's `arc-override`
   constraint remains available and is tested (`tests/story-engine.test.ts`, "honors an
   explicit arc-override constraint"), but an override still cannot manufacture a missing
   required beat (§15: "MUST NOT manufacture a missing required beat") — so overriding to
   e.g. `before-interaction-after` without a `current-state` candidate will correctly
   produce `conditional`/`fail` via `StoryCoverage`, not a fabricated beat. The contract
   types support all nineteen kinds and all eight arcs; only the reference candidate
   generator's source-record coverage is narrow. Widening this to the full 19/19 requires
   implementing candidate rules for the missing kinds against their documented valid
   source evidence (§6's table) — mechanical, but out of scope for this audit's
   correction pass, which was scoped to fixing confirmed non-conformities rather than
   expanding candidate-generation breadth.
5. **`StoryAudience` is accepted verbatim from `StoryCompilerInput.audience`** rather than
   derived from DIR `audience`/`goal` with a documented mapping; when omitted it falls
   back to `DEFAULT_STORY_AUDIENCE` and is not yet recorded as a dedicated
   `audience-selected` `StoryDecision`/gate warning (§14).
6. **Duration compression** shrinks all scenes toward a uniform per-scene share and the
   1500ms floor; it does not yet implement the full §18 priority-ordered
   supporting-then-important compression/removal search.
7. **CLI input format**: the CLI now accepts YAML (per §32) as well as JSON, resolved by
   file extension — this was corrected by this audit (previously JSON-only, which was a
   confirmed §32 non-conformity). It still accepts a single document with upstream
   artifact payloads inlined, rather than artifact-id references resolved against a
   filesystem registry; that inlining, and `BrowserCaptureRunInput`'s
   `runId`/`artifactId`/`capturedAt` wrapper (needed because `BrowserCaptureResult` itself
   does not carry that run identity), remain scoped simplifications, not RFC violations —
   §32 describes the CLI's *input format* (YAML) normatively but leaves artifact
   composition/resolution mechanics unspecified.

None of these limitations contradicts an RFC-0005 invariant — they narrow *how much* of
the candidate/scoring space the reference compiler explores, not *what* it is allowed to
conclude. Every Storyboard the reference compiler emits still satisfies every contract
invariant it evaluates (beat/scene exclusivity, causal ordering, no fabricated proof, no
silent duration default, no silent Hero Interaction replacement).

## Deferred to RFC-0006

Screenplay prose, final voiceover writing, music selection, motion design, camera
execution, Remotion composition, image/video generation, a Render Gate, MP4 export. The
`Storyboard` contract's `ScenePresentationIntent`/`StoryTransitionIntent` fields are
renderer hints only, per §30's renderer boundary — no renderer-specific value (CSS,
frame numbers, easing curves, audio files) appears anywhere in `src/core/story.ts`.
