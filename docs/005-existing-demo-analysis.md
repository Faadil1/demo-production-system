# RFC-0003 — Existing Demo Analysis

## Status

Accepted for implementation.

## Purpose

Give DPS a deterministic, local-first way to analyze an *existing* demo video —
turning a local video file plus optional transcript/observation data into a structured,
inspectable `ExistingDemoAnalysis` artifact. This is the reverse direction of RFC-0001/
RFC-0002 (which build a demo forward from a manifest): here, DPS looks at a demo that
already exists and reports, honestly and reproducibly, what it can and cannot conclude
about it.

Nothing in this RFC performs computer vision, speech recognition, or LLM-based semantic
analysis. Where those capabilities would be needed to support a conclusion, the engine
says so explicitly (via `unknowns`, `risks`, and the Analysis Gate) rather than
pretending to have observed something it did not.

## Contracts

| File | Purpose |
|---|---|
| `src/core/media-source.ts` | `MediaSource` — a `local-video`, `youtube-url`, or `remote-url` reference. Only `local-video` is ever inspected; `resolveLocalVideoPath` refuses to treat a URL-shaped URI as a local path. |
| `src/core/media-inspection.ts` | `MediaInspection` — mechanically-read container/stream metadata, or a structured `unsupported`/`unavailable`/`invalid` status. |
| `src/adapters/media-inspector.ts` | The replaceable `MediaInspector` interface. |
| `src/adapters/ffprobe-media-inspector.ts` | The reference implementation: local `ffprobe`, invoked via `execFile` with an argument array (never shell-concatenated), JSON output only, no screenshots/frames, no network. |
| `src/core/transcript.ts` | `Transcript` — optional, human/caption/STT-sourced spoken text. `validateTranscript` checks chronology, non-empty text, confidence bounds, and (when duration is known) a documented duration tolerance. |
| `src/core/demo-observation.ts` | `DemoObservationTimeline` — optional, externally supplied observations (human reviewer, future CV/browser adapter, or fixture data) about what is visible/happening at specific timestamps. |
| `src/core/demo-score.ts` | The 100-point `DemoScore` model shared by the engine. |
| `src/core/existing-demo-analysis.ts` | The top-level `ExistingDemoAnalysis` artifact and all its supporting analysis types. |
| `src/engines/existing-demo-analysis.ts` | `ExistingDemoAnalysisEngine` — the deterministic reference engine. |

## Provenance model: fact vs. transcript vs. observation vs. inference

RFC-0003 extends RFC-0002's fact/claim/hypothesis distinction into the video domain:

- **Media inspection facts** (`MediaInspection`) are mechanically read from the file via
  `ffprobe` — container format, duration, stream codecs. These are the only things the
  reference implementation "observes" on its own.
- **Transcript segments** are spoken words, supplied externally (human transcription,
  caption file, or a future speech-to-text adapter). **A transcript is never proof that
  the product visibly demonstrated something** (Core Principle 3) — `TranscriptSummary`
  reports word count, words-per-minute, and language, but never visual claims.
- **Observations** (`DemoObservation`) are the only way visual/behavioral claims enter
  the system, and they are always externally supplied — by a human reviewer today, by a
  future computer-vision or browser-capture adapter later. The engine never invents
  observations.
- **Inferences** are the engine's own deterministic conclusions *about* the supplied
  observations/transcript (Hero Interaction status, structure sections, risks,
  unknowns) — always derived by fixed rules, never by a model, and always carrying their
  own `confidence` rather than borrowing the confidence of what they're derived from.

### A spoken claim is not visual evidence

This is enforced structurally, not just by convention: in `analyzeEvidence()`, a
`claim-spoken` observation's evidence item is **always** forced to
`verificationStatus: "unverified"`, regardless of what `verificationStatus` was
supplied on the input observation. A transcript or narration can never earn
visual-evidence credit (see Scoring below) or count toward `verifiedVisualEvidenceCount`.

### Verification is never promoted

`verificationStatus` (`unverified` / `partially-verified` / `verified` / `contradicted`)
is taken at face value from whatever supplied the observation. The reference engine:

- Never marks anything `verified` on its own initiative.
- Never treats an inferred conclusion (Hero Interaction status, structure) as evidence
  in itself — those are conclusions *about* evidence, not evidence.
- Only counts `proof-visible`, `result-visible`, and `before-after-pair` items toward
  `verifiedVisualEvidenceCount` — never `claim-spoken` or `claim-on-screen`.

## Hero Interaction detection

Detection (`detectHeroInteraction` in `src/engines/existing-demo-analysis.ts`) uses
fixed rules over the observation timeline only — **transcript content is never
consulted**, so a Hero Interaction can never be inferred from spoken language alone.

For each `interaction-start` observation (chronologically), the engine looks for:

1. The next `interaction-complete` or `state-change` observation at or after it.
2. The next `result-visible` or `proof-visible` observation at or after the start.
3. A minimum confidence of `0.5` across all three observations (`min(start, complete,
   proof)`).

Every complete, sufficiently-confident chain is a candidate. The candidate(s) with the
highest confidence are compared:

- **`identified`** — exactly one strongest candidate, and at least one of its three
  observations is `verified`.
- **`candidate-only`** — exactly one strongest candidate, but none of its observations
  are verified.
- **`ambiguous`** — more than one candidate ties for the highest confidence.
- **`not-found`** — no complete chain exists (including when there is no
  `interaction-start` observation at all, or only a transcript).

The selection rationale is recorded in a `DecisionRecord` (`...-hero-selection`) on
every run.

## Demo structure analysis

Structure is derived from fixed observation-kind rules (see
`analyzeStructure()`) — it never claims a semantic section exists without a supporting
observation:

- `opening` / `problem` ← `title-card` / `problem-context` observations.
- `product-introduction` ← the first `product-ui-visible` observation.
- `hero-interaction` ← the identified/candidate-only Hero Interaction's span.
- `evidence` ← `proof-visible` observations.
- `result` ← `result-visible` observations.
- `call-to-action` / `closing` ← `call-to-action` observations.
- `workflow` has no dedicated observation kind today and is always reported as missing
  — a documented future-extension point, not a fabricated range.

Sections with no supporting observations are listed in `missingSections`, never
invented with a guessed time range. `DemoStructureAnalysis.confidence` is the mean of
detected-section confidences over all considered section types (detected + missing).

## Scoring

`DemoScore` is a 100-point, fully explainable score (`src/core/demo-score.ts` +
`computeScore()`):

| Category | Max points |
|---|---|
| Product clarity | 15 |
| Problem framing | 10 |
| Hero Interaction | 20 |
| Evidence quality | 25 |
| Result visibility | 10 |
| Narrative structure | 10 |
| Rhythm and pacing | 5 |
| Closing / CTA | 5 |
| **Total** | **100** |

Every category carries `rationale`, `supportingObservationIds`, and `deductions` — every
awarded (or withheld) point is traceable to specific input data. Key rules:

- **Absence of data never inflates the score.** No observations and no transcript ⇒
  every category defaults to its "nothing supplied" branch ⇒ total `0` ⇒ grade
  `insufficient`.
- **Hero Interaction points scale with status**: `identified` 20, `candidate-only` 10,
  `ambiguous` 5, `not-found` 0.
- **Evidence quality is driven by `proofCoverageRatio`** (verified / total provable
  items among `proof-visible`, `result-visible`, `before-after-pair`), plus a fixed +5
  bonus for at least one verified before/after pair. **Spoken claims can never
  contribute** — the evidence-item forcing described above means a transcript-only demo
  always scores `0` here.
- All category scores are clamped to `[0, maximumPoints]` via `clampScore()`.
- Grades: 90–100 excellent, 75–89 strong, 60–74 adequate, 40–59 weak, 0–39 insufficient.
- The score is a pure function of the engine's other analyses — identical input always
  produces an identical score.

## The Analysis Gate

```text
gate:
  name: "existing-demo-analysis"
  status: pass | conditional | fail
  blockingReasons: string[]
  warnings: string[]
  requirementsBeforeUse: string[]
```

Deterministic policy (`computeGate()`):

- **FAIL** ("analysis cannot run / cannot be trusted") when: media inspection status is
  not `"inspected"`, duration is unknown, no video stream exists, neither a transcript
  nor an observation timeline was supplied at all, `goal: "prove"` was declared but no
  Hero Interaction could be identified, or a `critical`-severity risk exists.
- Otherwise **CONDITIONAL** ("analysis ran, but conclusions are incomplete") when the
  Hero Interaction is not `"identified"`, no verified visual proof exists, no
  `result-visible` observation was supplied, or no transcript was supplied.
- **PASS** only when media is validly inspected with a known duration and video stream,
  the Hero Interaction is `identified`, at least one visual evidence item is verified,
  the result is visibly demonstrated, and a transcript is present.

The gate is computed and persisted **even when it is `fail`** — a failed gate is an
honest, deterministic conclusion, not a crash, and `analyze-demo`'s exit code (not an
aborted pipeline) is what communicates it. This mirrors, and is distinct from, RFC-0002:
Planning/DIR compilation *refuse* to proceed past a failed Understanding Gate because
DIR feeds rendering; here there is nothing downstream to protect, so the artifact is
always written for inspection.

## CLI usage

```bash
npm run analyze-demo -- <path-to-analysis.yaml>
```

The YAML declares a `source` (`MediaSource`), optional `goal`, optional `transcript`,
and optional `observationTimeline` (see `examples/existing-demo/analysis.yaml`). The
local video path in `source.uri` is resolved relative to the YAML file's own directory.

Behavior:

- Missing argument → usage message, exit 1, no run directory.
- Malformed YAML / transcript / observation structure → validation errors, exit 1, no
  run directory (checked before any media inspection or engine run).
- Otherwise, the pipeline always runs to completion and writes:
  `source.json`, `media-inspection.json`, `transcript.json` (if supplied),
  `observations.json` (if supplied), `existing-demo-analysis.json`, `decisions.json`,
  `events.json`, `run-summary.json` under `.dps/runs/<run-id>/`.
- Exit code 0 for a `pass` or `conditional` gate; exit code 1 for a pipeline exception
  or a `fail` gate (`src/cli/exit-code-policy.ts`).
- The source video file is never copied into the artifact directory, and no network
  request is ever made — `youtube-url`/`remote-url` sources are represented but always
  return an `"unsupported"` `MediaInspection`.

## Current limitations

- No capture, computer-vision, OCR, or speech-to-text adapter exists yet — all
  `DemoObservation` and `Transcript` data must be supplied externally (by a human or a
  fixture). `sourceType: "inference"` observations are supported by the type system but
  never produced by this reference engine.
- Evidence-to-claim linkage (`relatedEvidenceIds`) is taken at face value from the
  input; the engine does not attempt to infer which evidence supports which claim.
- The `workflow` structure section has no supporting observation kind and is always
  reported missing.
- Before/after pairing is a simple deterministic nearest-chronological-match; it does
  not attempt semantic matching of *which* state changed.
- Rhythm/pacing thresholds (gap ratio > 30%, average observation duration < 5% of total
  duration) are fixed, documented constants, not learned or configurable per demo.

## Future extension points (not implemented here)

- YouTube ingestion adapter (download + local inspection) — `youtube-url` sources are
  represented in the type system today but never fetched.
- Speech-to-text adapter — would populate `Transcript` with `sourceType:
  "speech-to-text"`.
- Scene/frame extraction adapter — would populate `DemoObservation`s with `sourceType:
  "capture"` from real frame analysis.
- Visual observation adapter (a future computer-vision pipeline) producing
  `product-ui-visible` / `proof-visible` / `state-change` observations automatically.
- OCR adapter — would populate `claim-on-screen` observations from on-screen text.
- LLM-assisted semantic analyzer — explicitly out of scope for the reference engine;
  any future LLM-based adapter must still respect the fact/claim/hypothesis/evidence
  provenance model established here and in RFC-0002.
