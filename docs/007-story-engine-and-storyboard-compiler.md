# RFC-0005 — Story Engine & Storyboard Compiler

Status: Accepted for implementation
Implementation: Not started

---

## 1. Executive summary

RFC-0001 through RFC-0004 establish a chain of **evidence-producing** artifacts: `ProductUnderstanding` (RFC-0002) states what is true and how confidently; `DemoIntermediateRepresentation`/DIR (RFC-0002) states what the demo must accomplish; `ExistingDemoAnalysis` (RFC-0003) evaluates prior demo attempts against that evidence; `BrowserCaptureResult` (RFC-0004) proves specific product behavior actually happened, with assertions, screenshots, sanitized DOM snapshots, and network records.

None of these artifacts is a story. A `ProductUnderstanding` with 40 verified facts is not narratable by itself — it has no order, no audience framing, no sense of which fact matters *first*, and no notion of a beginning, middle, and end. Evidence answers "what is true." A story answers "what does the audience need to understand, and in what order, to reach a specific conclusion." Collapsing these two concerns — as ad hoc demo scripts and one-shot LLM narration tools do — produces demos that are either chronological screen-recording dumps (faithful to capture order, useless as narrative) or confident-sounding fabrications (narratively coherent, factually unmoored).

RFC-0005 inserts a **Story Engine** between evidence (RFC-0002–0004) and rendering (RFC-0006, not yet specified). The Story Engine's only raw materials are facts, claims, hypotheses, evidence items, observations, findings, and decisions that already exist in upstream artifacts. It is not permitted to invent new product facts. Its allowed operations are: **select, reject, prioritize, group, order, compress, connect, justify**. The output is a `Storyboard` — a complete, renderer-independent demo plan expressed as ordered scenes with explicit evidence backing, semantic presentation intent, duration targets, an explicit `storyMode`, a `RendererReadiness` assessment, and a pass/conditional/fail Story Gate.

Rendering is deliberately excluded. A `Storyboard` says a scene must *demonstrate* a *focused-element* view with *metric* text intent and a *reveal* transition; it does not say which React component, which easing curve, or which pixel crop achieves that. This separation lets the Story Engine be **fully deterministic and testable without producing a single frame of video** — an important property for a system whose core promise is that demos do not lie about what the product does.

This document is the **accepted v0.1 specification**. All architectural decisions previously open for owner review are now resolved and apply normatively throughout. A future developer implementing RFC-0005 is expected to follow this document without making further architectural choices; remaining implementation-level details (exact scoring weights, exact numeric thresholds pending fixture calibration) are flagged explicitly where they occur and do not change the contracts or invariants defined here.

```
ProductUnderstanding
+ DIR
+ ExistingDemoAnalysis (optional)
+ BrowserCaptureResult(s)
        │
        ▼
Story Input Normalization
        │
        ▼
Narrative Beat Selection
        │
        ▼
Scene Construction
        │
        ▼
Sequence Ordering
        │
        ▼
Storyboard Compilation
        │
        ▼
Story Gate
```

RFC-0005 deliberately excludes screenplay prose, voiceover writing, music, motion design, camera execution, video editing, Remotion composition, and any form of generative creative exploration. It prepares RFC-0006 (the renderer) by handing it a `Storyboard` whose every scene is traceable to upstream evidence, whose ordering is justified by explicit `StoryDecision`s, and whose duration and evidentiary requirements are already resolved — so RFC-0006's job is strictly "how to show this," never "what to show."

---

## 2. Problem statement

Without a Story Engine, a system that merely has evidence tends to produce one of the following failure modes when asked to "make a demo":

1. **Chronological screen-recording dumps.** Scenes appear in capture order rather than narrative order, because capture order is the only order available.
2. **Feature-list demos.** Every captured interaction gets a scene regardless of narrative necessity, because there is no mechanism to reject non-essential material.
3. **Unsupported marketing claims.** A claim from the manifest ("10x faster") appears as an on-screen statement with no evidence reference, because nothing enforces claim-to-evidence traceability at the story layer.
4. **Screenshots presented as proof without assertions.** A screenshot shows a screen, not a passed condition; without an eligibility rule, screenshots get treated as functional proof.
5. **Duplicate scenes.** The same evidence gets narrated twice from two artifacts (e.g., RFC-0003 analysis and RFC-0004 capture) because there is no dedup/priority rule across sources.
6. **Missing Hero Interaction.** The single interaction identified as the product's core value moment gets diluted across many equally-weighted scenes, or omitted entirely under duration pressure, or silently swapped for whichever interaction happened to complete successfully in capture.
7. **Proof appearing before its context.** A result is shown before the audience has seen the action that produced it, breaking causal legibility.
8. **Result without visible cause.** An outcome (e.g., "3 minutes saved") appears with no interaction shown that plausibly caused it.
9. **CTA disconnected from demonstrated value.** The call-to-action asserts value the demo never proved.
10. **Renderer inventing narrative structure.** Without a renderer-independent plan, RFC-0006 (or any renderer) ends up making narrative decisions — which scene matters more, what order things go in — that belong upstream and should be auditable independent of rendering technology.
11. **Excessive scene count.** No mechanism bounds scene count relative to duration budget, producing frantic, unwatchable demos.
12. **Overlong setup.** Context-setting consumes a disproportionate share of runtime, starving proof and result.
13. **Contradictory claims.** Two upstream sources disagree (e.g., manifest says "always succeeds," a browser assertion failed) and nothing surfaces or resolves the conflict before it reaches a viewer.
14. **Low-confidence evidence treated as definitive.** A hypothesis or partially-verified fact gets narrated with the same certainty as a verified fact, or an unverified impact claim gets included in a promotional story merely because it is technically labeled "unverified."
15. **Visually polished but logically incomplete demos.** A demo can be well-produced (RFC-0006's concern) and still fail to prove its central claim (RFC-0005's concern) — these must be separately gatable.

RFC-0005 exists to make each of these failure modes structurally difficult: each has a corresponding rule, invariant, or gate condition defined below.

---

## 3. Goals

RFC-0005 MUST deliver:

- A renderer-independent story representation (`Storyboard`) that fully specifies *what* a demo says and shows, never *how* it is rendered.
- A deterministic reference compiler: identical inputs MUST produce identical (structurally, not just semantically) output.
- Evidence-backed scene selection: every scene traces to specific upstream fact/claim/evidence/observation IDs.
- Traceable rejection decisions: every candidate beat or scene not selected has a recorded reason.
- Explicit narrative roles for every beat and scene (context, cause, interaction, proof, result, limitation, etc.).
- Hero Interaction protection: the human-selected Hero Interaction cannot be silently dropped, silently replaced by a technically-successful alternative, reordered incorrectly, or diluted without gate impact.
- Proof and result visibility: causal order (cause → interaction → proof → result) is a structural invariant, not a style preference.
- Duration-budget planning: scenes fit a target runtime through deterministic compression/removal rules, not ad hoc truncation.
- Narrative completeness evaluation via `StoryCoverage` and `StoryMetrics`.
- Preservation of uncertainty: confidence and verification status propagate from evidence through beats, scenes, and the gate — never silently upgraded.
- An explicit `storyMode` discriminant (`"promotional" | "diagnostic"`) governing how failures and limitations are treated.
- An explicit `RendererReadiness` assessment feeding the single Story Gate.
- Stable serialization: consistent ID generation, ordering, and JSON shape across runs.
- Compatibility with future renderers: `Storyboard` output must be consumable by any renderer that respects the presentation-intent contract, not just a Remotion-based RFC-0006.
- Testability without video production: every stage of the pipeline is a pure function over JSON-serializable input/output.

---

## 4. Non-goals

RFC-0005 explicitly does **not** include:

- Screenplay prose generation or final voiceover writing (voice *intent*, not voice *text*, belongs here — see §10, §13).
- Music selection.
- Motion design, camera execution, or video editing.
- Remotion composition or any renderer-specific implementation.
- Image generation.
- Autonomous creative exploration (no free-form generative narrative structure — see §15, arcs are a closed reference set).
- Product fact invention of any kind.
- Promotion of unverified claims to verified status.
- Browser capture, OCR, or computer vision (these are RFC-0004 and future-adapter concerns).
- LLM-based storytelling in the reference implementation (an LLM-assisted candidate generator MAY exist as a future extension behind strict validation — see §39 — but the reference compiler MUST be deterministic and non-generative).
- Automatic CTA fabrication (a CTA scene MUST be evidence-backed like any other scene, and MAY be entirely absent when the objective does not require one).
- Audience analytics or engagement measurement.
- Judge simulation or automated demo scoring against external rubrics.
- Final captions, title cards, voiceover prose, narration scripts, subtitle files, word-level timing, or audio assets (see §13 — these belong to a future compilation/rendering RFC).
- Ranked alternative storyboards, tournaments, A/B variants, or multi-duration variants in v0.1 (see §14, §39 — the reference compiler emits exactly one canonical `Storyboard` per compilation).

RFC-0005 MAY define extension points (e.g., pluggable `NarrativeArc` packs, pluggable beat-candidate generators) but MUST NOT require them for the v0.1 reference implementation.

---

## 5. Terminology and hierarchy

| Term | Definition |
|---|---|
| **Story Source** | One upstream artifact instance supplied to the compiler: a `ProductUnderstanding`, a `DemoIntermediateRepresentation`, an `ExistingDemoAnalysis`, or a `BrowserCaptureResult`. Each Story Source is uniquely identified by its `artifactId`/`runId` pair from the RFC-0001 `ArtifactEnvelope`. |
| **Story Fact** | A normalized reference to an upstream `Fact`, `Claim`, `Hypothesis`, `EvidenceItem`, `DemoObservation`, `ExistingDemoEvidenceItem`, `BrowserAssertionResult`, or similar atomic upstream record, wrapped with its original verification status and source artifact ID. The Story Engine never creates new Story Facts from nothing — every one resolves to an upstream record. |
| **Story Claim** | A normalized reference to an upstream `Claim` or DIR `EvidenceReference["claim"]` string — a statement the demo is meant to substantiate. |
| **Story Evidence Reference** | The typed pointer contract defined in §8, linking a beat or scene to the Story Fact(s)/Story Claim(s) that justify it. This is the canonical normalized proof input referenced by `ProofChain.evidenceRefIds` (§17). |
| **Narrative Beat** | The smallest unit of narrative intent: "the audience must understand X." A beat has a `kind` (§6), a required takeaway, and evidence references. Beats are pre-visual — they say nothing about how they will be shown. Each beat belongs to exactly one selected scene (§9, Decision 1). |
| **Scene** | The evidence-backed, renderer-independent unit that carries one or more beats into a specific presentation intent, duration target, and evidence set. Scenes are what RFC-0006 consumes. Each scene belongs to exactly one sequence (§9, §12, Decision 2). |
| **Sequence** | An ordered group of Scenes serving one coherent narrative purpose (e.g., "problem," "demonstration," "proof"). Sequences give the Storyboard its top-level shape. Scenes are not shared between sequences; sequences relate to each other only through scene `dependsOnSceneIds` and `ProofChain` references. |
| **Storyboard** | The complete, renderer-independent demo plan: all beats, scenes, sequences, the Hero Interaction Sequence, proof chains, duration budget, coverage, metrics, decisions, `storyMode`, `rendererReadiness`, and gate. Exactly one `Storyboard` is emitted per compilation (§14). |
| **Narrative Arc** | A named, closed-set structural template (§15) that determines which beat kinds are required/optional/forbidden and their relative ordering. |
| **Story Transition Intent** | A semantic (not visual) statement of how one scene relates to its neighbor — e.g., `cause-to-effect`. Renderer-neutral; see §11. |
| **Story Constraint** | A caller-supplied restriction or authorization on compilation (e.g., "no scene may exceed 8000 ms," "CTA is required," `"allow-unverified-impact"`, an arc override). Distinct from invariants, which are unconditional. |
| **Story Decision** | A `DecisionRecord`-compatible entry (§21) documenting one compiler choice: input, rule applied, alternatives, outcome, confidence, reversibility. |
| **Rejected Candidate** | A beat or scene that was generated as a candidate but not selected, with a reason code (§20). |
| **Story Coverage** | The quantitative record (§23) of how much of the required narrative surface (claims, beats, proof) the Storyboard actually satisfies. |
| **Story Gate** | The single pass/conditional/fail verdict (§25) on whether the Storyboard is fit to proceed to rendering. `RendererReadiness` (§9a) is a structured dimension feeding this one gate, not a second gate. |
| **Duration Budget** | The deterministic allocation (§18) of target runtime across sequences and scenes. |
| **Hero Interaction Sequence** | The protected contract (§16) carrying the single most important product interaction through start → progress → completion → proof → result, under the authority model of §16. |
| **Proof Chain** | The traceable path (§17) from a claim through the normalized evidence references, scenes, and (for browser-sourced evidence) assertions/artifacts that substantiate it. |
| **Audience Takeaway** | The one-sentence statement, required on every beat, of what the audience should believe or know after that beat plays. |
| **Renderer Hint** | Any field prefixed "presentation," "transition," or "intent" in a scene. **Renderer Hints are non-binding semantic intent, not implementation instructions.** RFC-0006 MAY choose how to realize `visualRole: "prove"`, but MUST NOT reinterpret *whether* a scene proves something — that is fixed by evidence, not by rendering choice. |
| **Story Mode** | The required `storyMode: "promotional" \| "diagnostic"` discriminant on every `Storyboard` (§9a, §26). It is a normative v0.1 field, not a future or optional extension. |

---

## 6. Narrative beat model

RFC-0005 defines a **closed** taxonomy of `NarrativeBeatKind` values. The reference compiler MUST NOT emit a beat kind outside this list; a future extension that needs a new kind requires an RFC amendment, not a runtime escape hatch.

| Kind | Purpose | Valid source evidence | Invalid source evidence | Common misuse | Required? | Position range | Repeats? | Confidence expectation |
|---|---|---|---|---|---|---|---|---|
| `hook` | Capture attention with the sharpest available fact/consequence before context is established | High-importance `Fact`/`ExistingDemoRisk`/DIR goal | Unverified hypothesis | Using a marketing claim with no evidence | optional | first 1–2 positions | no | ≥ 0.5 |
| `audience-context` | Orient the specific audience (role, familiarity) named in `StoryAudience` | `StoryAudience` fields, DIR `audience` | Invented persona detail | Fabricating audience pain not in evidence | conditional (required if audience unfamiliar) | early | no | n/a (structural, not evidentiary) |
| `problem` | State the problem the product addresses | `ProductUnderstanding.product.problem`, supporting `Fact`s | Hypothesis alone (unless explicitly labeled, see §8) | Overstating problem severity beyond evidence | required unless arc omits it | early | no | ≥ 0.6 |
| `consequence` | Show the cost of the unsolved problem | `Fact`/`EvidenceItem` tied to problem | Hypothetical dollar figures | Numeric invention | optional | after `problem` | no | ≥ 0.6 |
| `current-state` | Describe the pre-product workflow/status quo | `Fact`, `ExistingDemoAnalysis.structure` | none inferred from silence | Assuming a "before" that was never observed | optional | early-mid | no | ≥ 0.5 |
| `goal` | State the desired outcome (alternative/complement to `problem`) | DIR `goal`, `ProductUnderstanding.product.valueProposition` | none | Confusing goal with CTA | conditional (arc-dependent) | early | no | n/a |
| `product-introduction` | Introduce the product itself | `product.name`, `product.valueProposition` | none | Introducing before problem is legible | required unless arc omits it | early-mid | no | n/a |
| `mechanism` | Explain *how* the product works, pre-interaction | `Fact`/`Claim` about mechanism | Speculative architecture claims | Overpromising internals not evidenced | optional | mid | no | ≥ 0.5 |
| `interaction-start` | Mark the beginning of the Hero Interaction (or a supporting interaction) | `BrowserStepResult`, `DemoObservation` | Narrated-only interaction with no observation | Starting mid-action with no setup | required if Hero Interaction present | mid | no | ≥ 0.6 |
| `interaction-progress` | Show intermediate interaction state | `BrowserStepResult`, `BrowserDomSnapshotArtifact` | none | Padding runtime with redundant progress beats | optional | mid | yes (bounded, see invariants) | ≥ 0.5 |
| `interaction-complete` | Mark interaction completion | `BrowserStepResult(status: completed)` | `BrowserStepResult(status: failed)` promoted to "complete" | Declaring completion despite failed step | required if Hero Interaction present | mid | no | ≥ 0.7 |
| `proof` | Substantiate a claim with verifiable evidence | Eligible `StoryEvidenceReference` with `role: "proof"` per §8 | Screenshot alone; failed assertion | Treating a screenshot as functional proof | conditional (required for critical claims) | after cause | yes (one per proof chain) | ≥ 0.8 for `verified` |
| `comparison` | Contrast before/after or product/alternative | Paired `Fact`/`EvidenceItem` on both sides | One-sided evidence dressed as comparison | Comparing to an uncited competitor claim | optional | mid-late | yes | ≥ 0.6 |
| `result` | Show the outcome of the interaction | `DemoObservation` after interaction, `ExistingDemoEvidenceItem(kind: result-visible)` | Outcome with no preceding cause | Result before interaction (causal-order invariant violation) | required if Hero Interaction present | after `interaction-complete`/`proof` | no | ≥ 0.6 |
| `impact` | Generalize the result to business/user value | `Fact`/`Claim` tied to `result`, or a hypothesis governed by the unsupported-impact policy (§8, §14, §22) | Unlinked ROI figures | Silent hypothesis-to-fact promotion; assuming "unverified" labeling alone permits inclusion | optional | late | no | governed by §22 unsupported-impact policy |
| `trust` | Signal credibility (security, compliance, scale) | `Fact`/`EvidenceItem` | Logos/testimonials with no evidence record | Trust theater with no backing | optional | late | no | ≥ 0.6 |
| `limitation` | Disclose a known gap, failure, or constraint | Failed `BrowserAssertionResult`, `ExistingDemoRisk`, `Risk` | Omission (silence is not a limitation beat) | Assuming every failed assertion must become a public scene | governed by the mode-specific policy in §22 | any | yes | n/a — limitation beats do not carry a "confidence of success" |
| `next-step` | Tell the audience what to do next, non-commercially (docs, trial setup) | DIR `goal`, `StoryObjective` | none | Confusing with `call-to-action` | optional | last | no | n/a |
| `call-to-action` | Explicit ask (buy, book, sign up) | `StoryObjective` in `persuade-*` set | none | Asking for action beyond what was demonstrated | required only for `persuade-to-try`/`persuade-to-review`/`persuade-to-buy`; optional otherwise; never required in diagnostic mode (§14) | last | no | n/a |

**Minimal viable narrative** (the shortest sequence any Storyboard MUST satisfy to reach `pass`, absent an arc-specific exception):

```
problem | goal → product-introduction → interaction-start..interaction-complete → proof → result → next-step | call-to-action
```

**Valid alternatives by product category** (each substitutes the interaction/proof portion of the minimal narrative; all still require product-introduction and a closing beat):

- **Developer tool**: `mechanism → interaction-start → interaction-complete → proof (test/build passes) → result (time/lines saved)`
- **Infrastructure product**: `current-state → interaction (config/deploy) → proof (system state change) → result (reliability/latency metric)`
- **Workflow product**: `problem (manual process) → interaction (automated flow) → comparison (before/after) → result`
- **API product**: `mechanism (request shape) → interaction (call made) → proof (response/assertion) → result (integration outcome)`
- **Consumer product**: `hook → problem → interaction → result → trust → call-to-action`
- **Before/after demo**: `current-state → interaction → comparison → result` (comparison is required, not optional, in this arc)
- **Diagnostic demo**: `current-state → interaction → limitation (or proof) → result` — MAY terminate in `limitation` without a `call-to-action` (diagnostic mode never requires a CTA, §14, §26)
- **Comparison demo**: `problem → comparison → interaction (on the selected side) → proof → result`

**Duplicate narrative idea rule** (Decision 1): if the same narrative idea would otherwise be shown more than once (e.g., two scenes both establishing "the product is easy to use"), it MUST be represented as separate `NarrativeBeat` records with distinct `id`, distinct `purpose`, and distinct provenance (`sourceClaimIds`/`sourceFactIds`/`evidenceRefs`) — never as one beat ID reused across scenes. A candidate that would require reusing a beat ID across two scenes is rejected per §9's beat-ownership invariant, and the weaker occurrence is recorded with `reasonCode: "duplicate"` (§20).

---

## 7. NarrativeBeat contract

```ts
// DRAFT CONTRACT — not implemented.
type NarrativeBeatKind =
  | "hook" | "audience-context" | "problem" | "consequence" | "current-state"
  | "goal" | "product-introduction" | "mechanism"
  | "interaction-start" | "interaction-progress" | "interaction-complete"
  | "proof" | "comparison" | "result" | "impact" | "trust"
  | "limitation" | "next-step" | "call-to-action";

type NarrativeBeat = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly kind: NarrativeBeatKind;
  readonly purpose: string;
  readonly audienceTakeaway: string;
  readonly sourceClaimIds: readonly string[];
  readonly sourceFactIds: readonly string[];
  readonly evidenceRefs: readonly StoryEvidenceReference[];
  readonly requiredObservationIds: readonly string[];
  readonly confidence: number;               // [0, 1]
  readonly importance: "supporting" | "important" | "critical";
  readonly verificationStatus:
    | "verified" | "partially-verified" | "unverified";
  readonly uncertaintyNotes: readonly string[];
  readonly mustAppear: boolean;
  readonly dependencies: readonly string[];   // NarrativeBeat ids
  readonly conflictsWith: readonly string[];  // NarrativeBeat ids
};
```

### Invariants

- `confidence` MUST be in `[0, 1]`.
- A beat with `verificationStatus: "verified"` MUST have at least one `evidenceRefs` entry whose own `verificationStatus` is `"verified"`. A beat MUST NOT claim a higher verification status than its strongest evidence reference.
- A beat sourced solely from a `Hypothesis` MUST have `verificationStatus: "unverified"` and MUST record that fact in `uncertaintyNotes`. Hypotheses MUST NOT silently become facts — this applies transitively: a beat that depends on an unverified beat cannot itself be `"verified"`.
- Beats with `importance: "critical"` MUST have `verificationStatus` of at least `"partially-verified"`, and MUST have `evidenceRefs` from at least one `role: "proof"` or `role: "result"` reference if the beat `kind` is `proof`, `result`, or `interaction-complete`.
- `audienceTakeaway` MUST be non-empty. A beat without a stated takeaway is invalid — it has no narrative reason to exist.
- `dependencies` MUST form a directed acyclic graph across the full beat candidate set; a cycle invalidates all beats in the cycle.
- `sourceClaimIds` and `sourceFactIds` MUST NOT both be empty when `evidenceRefs` is non-empty for kinds other than `next-step`/`call-to-action` (which may be purely objective-driven, not fact-driven). A beat with empty `sourceClaimIds`, `sourceFactIds`, and `evidenceRefs` for any other kind is invalid — it is an invented beat.
- A beat whose `kind` is `impact` and whose only source is a `Hypothesis` or an otherwise-unsupported `Claim` is governed by the unsupported-impact policy (§14, §22): in promotional mode it remains a candidate or rejected candidate by default and MUST NOT be selected merely because it carries `verificationStatus: "unverified"`; it MAY be selected only under an explicit `"allow-unverified-impact"` constraint, and even then it can contribute at most to a `conditional` Story Gate, never `pass`, and MUST NOT satisfy required or critical `StoryCoverage`. In diagnostic mode it MAY appear as a clearly labeled hypothesis or investigation target but never counts as a verified result or proof.
- `purpose` MUST NOT be empty.
- Per §5/§9, each selected `NarrativeBeat` id appears in exactly one selected `StoryScene.beatIds`; the same beat id MUST NOT appear in more than one selected scene.

**Invalid-case example:** a candidate `impact` beat states "saves teams 10 hours/week" with `sourceFactIds: []`, `sourceClaimIds: ["claim-042"]` where `claim-042.evidenceIds` is empty. This beat is rejected at candidate generation (§19, reason `unsupported`) — a `Claim` with no backing evidence cannot justify a beat regardless of how compelling the statement is, and no constraint short of an explicit `"allow-unverified-impact"` override changes this.

---

## 8. Story evidence references

```ts
// DRAFT CONTRACT
type StoryEvidenceReference = {
  readonly id: string;
  readonly sourceType:
    | "understanding-evidence"     // ProductUnderstanding.evidence[]
    | "browser-assertion"          // BrowserAssertionResult
    | "browser-screenshot"         // BrowserScreenshotArtifact
    | "browser-dom"                // BrowserDomSnapshotArtifact
    | "capture-observation"        // DemoObservation (from BrowserCaptureResult.observationTimeline)
    | "analysis-observation"       // DemoObservation (from ExistingDemoAnalysis)
    | "analysis-finding"           // ExistingDemoEvidenceItem / risk / unknown
    | "dir-requirement"            // DIR EvidenceReference
    | "decision-record";           // DecisionRecord
  readonly sourceArtifactId: string;   // ArtifactEnvelope.artifactId of the owning artifact
  readonly sourceItemId: string;       // id of the specific item within that artifact
  readonly sourceRunId: string;        // runId of the owning artifact — required for multi-run disambiguation (§17, §26)
  readonly verificationStatus:
    | "verified" | "partially-verified" | "unverified";
  readonly role:
    | "context" | "cause" | "interaction" | "proof" | "result" | "limitation";
};
```

`StoryEvidenceReference` is the canonical normalized proof input for the entire Storyboard: `ProofChain.evidenceRefIds` (§17) resolves against these records, and every beat/scene evidence field is ultimately a set of `StoryEvidenceReference` ids.

### Evidence eligibility rules

- A `browser-screenshot` reference MAY support `role: "context"` or `role: "interaction"`. It MUST NOT alone support `role: "proof"` — a screenshot shows a screen state, not a verified condition.
- A `browser-assertion` reference with `status: "passed"` (per RFC-0004 `BrowserAssertionResult`) linked to at least one artifact (screenshot or DOM snapshot) MAY support `role: "proof"`.
- A `browser-assertion` with `status: "failed"` MUST NOT support `role: "proof"` or `role: "result"`. It MAY support `role: "limitation"`. Whether a failed assertion produces a *selected* limitation beat/scene is governed by the mode-specific policy in §22 — eligibility to support a `limitation` role does not by itself mandate selection.
- A transcript-only reference (spoken claim with no visual/state corroboration, per `ExistingDemoEvidenceItem(kind: "claim-spoken")`) MUST NOT alone support `role: "proof"`. Transcript text cannot become visual proof.
- A `Hypothesis`-sourced reference MAY support `role: "context"` only, and MUST carry `verificationStatus: "unverified"`; it MUST NOT support `role: "proof"`, `role: "cause"`, or `role: "result"`. An unverified impact reference is additionally governed by the §14/§22 unsupported-impact policy.
- An `analysis-finding` sourced from `ExistingDemoAnalysis` recommendations text is **not** product evidence — it describes a prior demo's quality, not the product's behavior. It MAY support only `role: "context"` beats about narrative strategy (e.g. informing beat selection), and MUST NOT be cited as evidence for a `proof` or `result` beat, and MUST NOT be cited as evidence that the *new* Storyboard is of good quality.
- A `capture-observation` reference MUST retain its originating `sourceArtifactId`/`sourceItemId`/`sourceRunId` (the RFC-0004 observation and, transitively, the `BrowserStepResult`/`BrowserAssertionResult` it derived from) — the Story Engine MUST NOT flatten provenance to just "a browser ran."
- Non-browser future evidence sources (see §17, §39) can achieve `role: "proof"` eligibility only through their own explicit, documented eligibility policy analogous to this section — eligibility is never assumed by analogy to browser evidence.

**Invalid-case example:** a candidate `proof` beat cites only `{sourceType: "browser-screenshot", role: "proof", verificationStatus: "unverified"}`. This reference set fails eligibility — the beat is rejected with reason `unsupported`, and (per §22) MAY instead be re-typed as a `context` beat if a valid `context` role exists for the same reference.

---

## 9. Scene model

```ts
// DRAFT CONTRACT
type StoryScene = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly beatIds: readonly string[];
  readonly primaryBeatId: string;
  readonly sequenceId: string;
  readonly order: number;
  readonly priority: "supporting" | "important" | "critical";
  readonly durationTargetMs: number;
  readonly durationRangeMs: { readonly minimum: number; readonly maximum: number };
  readonly requiredEvidenceRefs: readonly string[];
  readonly requiredClaimIds: readonly string[];
  readonly requiredObservationIds: readonly string[];
  readonly mustAppear: boolean;
  readonly mustNotAppearWith: readonly string[];      // StoryScene ids, mutual exclusion
  readonly dependsOnSceneIds: readonly string[];
  readonly supportsSceneIds: readonly string[];
  readonly transitionIn: StoryTransitionIntent;
  readonly transitionOut: StoryTransitionIntent;
  readonly presentationIntent: ScenePresentationIntent;
  readonly confidence: number;
  readonly whyThisSceneExists: string;
  readonly rejectionRisk: readonly string[];          // reason codes that could still remove this scene under compression
};
```

### Invariants

- **Beat ownership (Decision 1).** Every scene MUST have exactly one `primaryBeatId`, and it MUST be a member of `beatIds`. A given `NarrativeBeat` id MUST NOT appear in `beatIds` of more than one selected scene — beat ownership is exclusive to one scene. A scene MAY contain multiple beats. A repeated narrative idea MUST be modeled as distinct beats with distinct provenance (§6), never as one beat shared across scenes.
- **Scene ownership (Decision 2).** Every scene MUST belong to exactly one `sequenceId`. Scenes are never shared between sequences; cross-sequence relationships are expressed only through `dependsOnSceneIds`/`supportsSceneIds` and through `ProofChain` scene references (§12, §17), never by a scene appearing in more than one sequence's `sceneIds`.
- Every id in `beatIds`, `dependsOnSceneIds`, `supportsSceneIds`, and `mustNotAppearWith` MUST resolve to an existing beat/scene in the same `Storyboard`. Unresolved references invalidate the scene.
- `order` MUST be unique within `sequenceId` and MUST be a non-negative integer with no gaps required (gaps are permitted; duplicates are not).
- A scene with `mustAppear: true` MUST NOT be removed by duration compression (§18). Compression MAY shrink its `durationTargetMs` down to `durationRangeMs.minimum`, but removal requires either (a) an explicit `StoryConstraint` override recorded as a `StoryDecision`, or (b) the scene becomes structurally invalid (e.g., its evidence was withdrawn) — in which case the Story Gate MUST reflect the loss (§25).
- A scene whose beats include a `proof`-kind primary beat MUST have `requiredEvidenceRefs` containing at least one reference eligible for `role: "proof"` per §8.
- A scene whose beats include a `result`-kind primary beat MUST have at least one entry in `dependsOnSceneIds` pointing to a scene containing an `interaction-complete` or `proof` beat — a result scene requires an upstream cause.
- A scene whose beats include a `call-to-action`-kind primary beat MUST NOT introduce a `sourceClaimIds`/`sourceFactIds` reference that does not already appear in an earlier scene's beats — a CTA cannot claim unproven value.
- `durationRangeMs.minimum` MUST be ≤ `durationTargetMs` ≤ `durationRangeMs.maximum`, and `minimum` MUST be ≥ the reference minimum readable scene duration (§18, §25 numeric policy).
- `dependsOnSceneIds` across the full scene set MUST be acyclic.
- Two scenes that are each other's `mustNotAppearWith` MUST NOT both appear in the final `Storyboard.scenes`; if candidate generation produces both, one MUST be resolved via §20 scoring before compilation completes.
- **Renderer intent cannot override evidence requirements**: `presentationIntent` MUST NOT be used to satisfy `requiredEvidenceRefs` — e.g., a scene cannot claim `role: "proof"` satisfied merely by choosing `visualRole: "prove"`; the underlying reference must independently meet §8 eligibility.

**Invalid-case example:** a `result` scene ("users close the deal 30% faster") has `dependsOnSceneIds: []`. This is invalid per the causal-necessity invariant above — it is rejected at scene construction (§19 step 9) and demoted to a candidate with reason `dependency-missing`, unless a valid `interaction-complete`/`proof` scene is subsequently linked.

### 9a. Story mode and renderer readiness on Storyboard (Decisions 7 & 9)

Two additional required top-level fields exist on `Storyboard` (see §13): `storyMode` and `rendererReadiness`. They are introduced here because scene-level invariants above (e.g., `mustAppear` protection, CTA requirement) are evaluated *in light of* the resolved `storyMode`, and scene-level artifact availability is what `rendererReadiness` summarizes. See §26 for the full `storyMode` policy and §9's sibling section, plus §25/§28/§30/§31/§33/§34/§36/§37, for the full `RendererReadiness` policy.

---

## 10. Presentation intent

```ts
// DRAFT CONTRACT
type ScenePresentationIntent = {
  readonly visualRole: "establish" | "demonstrate" | "compare" | "prove" | "resolve" | "conclude";
  readonly framing:
    | "full-context" | "focused-element" | "before-after"
    | "side-by-side" | "progressive-reveal" | "persistent-context";
  readonly textIntent: "none" | "label" | "explanation" | "metric" | "warning" | "CTA";
  readonly voiceIntent: "none" | "context" | "explanation" | "emphasis" | "transition" | "conclusion";
  readonly motionIntent: "static" | "focus" | "reveal" | "replace" | "compare" | "track" | "hold";
  readonly artifactPreference:
    | "screenshot" | "DOM-derived" | "browser-recapture"
    | "generated-diagram" | "renderer-native" | "no-preference";
};
```

These fields are **semantic hints**, not implementation instructions. RFC-0006 decides how `visualRole: "prove"` is actually rendered — whether that means a highlighted DOM region, an animated counter, or a side-by-side screenshot comparison is a rendering decision. RFC-0005 fixes only *that* the scene functions as proof, not *how* that is shown.

Out of scope for `ScenePresentationIntent` (and for RFC-0005 generally): CSS, pixel coordinates, Remotion APIs or component names, font families, color values, animation easing curves, frame numbers, or audio file references. Any of these appearing in a `Storyboard` is a spec violation. See §13 for the full text/voice boundary.

---

## 11. Transition intent

```ts
// DRAFT CONTRACT
type StoryTransitionIntent =
  | "cut" | "hold" | "reveal" | "replace" | "compare" | "focus"
  | "zoom-intent" | "continuity" | "cause-to-effect"
  | "before-to-after" | "proof-to-result" | "conclusion";
```

| Transition | Semantic purpose | Valid neighbor beat kinds | Invalid usage | Duration effect |
|---|---|---|---|---|
| `cut` | Hard break between unrelated narrative units | any → any across sequence boundary | Between two beats sharing `dependsOnSceneIds` (loses continuity signal) | none |
| `hold` | Let the current state breathe before continuing | `interaction-complete` → `result`, `proof` → `result` | Between fast-moving `interaction-progress` beats | adds to minimum scene duration |
| `reveal` | Introduce new information not previously visible | `interaction-start` → `interaction-progress`, `mechanism` → `interaction-start` | As opening transition (nothing precedes to reveal from) | none |
| `replace` | Swap one visual state for a materially different one | `current-state` → `interaction-start`, `comparison` sides | `hook` → `problem` (too abrupt a state swap for an opening) | none |
| `compare` | Juxtapose two states for evaluation | `comparison` beat pairs, `before-after` framing | Single-beat scenes (nothing to compare) | may require wider duration range |
| `focus` | Narrow attention within an already-visible state | `interaction-progress` internal steps | Sequence-level transitions (too fine-grained) | none |
| `zoom-intent` | Signal increased detail without specifying camera mechanics | `mechanism` → `interaction-start` | Used as a proof mechanism itself (a zoom is not evidence) | none |
| `continuity` | Preserve visual/state continuity across a scene boundary | Hero Interaction internal scene chain | Across sequence boundaries with unrelated subject matter | none |
| `cause-to-effect` | Explicit causal linkage | `interaction-complete`/`proof` → `result` | `result` → `interaction-complete` (reversed) — **invalid**, causal-order violation | none |
| `before-to-after` | Explicit before/after linkage | `current-state` → `result`/`comparison` | Without an intervening interaction scene | none |
| `proof-to-result` | Explicit proof-to-outcome linkage | `proof` → `result` | `proof` → `hook` (non sequitur) | none |
| `conclusion` | Signal narrative closure | any → `next-step`/`call-to-action` | Mid-sequence use | none |

Transitions are semantic markers for RFC-0006, not decorative effects; a transition MUST be consistent with the causal-order invariant (§16) — `cause-to-effect`, `proof-to-result`, and `before-to-after` MUST NOT be applied in a direction that would place an effect before its cause.

---

## 12. Sequence model

```ts
// DRAFT CONTRACT
type StorySequenceKind =
  | "opening" | "context" | "problem" | "mechanism"
  | "demonstration" | "proof" | "outcome" | "conclusion";

type StorySequence = {
  readonly id: string;
  readonly kind: StorySequenceKind;
  readonly purpose: string;
  readonly sceneIds: readonly string[];
  readonly order: number;
  readonly durationBudgetMs: number;
  readonly required: boolean;
  readonly completionCriteria: readonly string[];
};
```

- **Ordering rules**: sequence `order` values MUST be unique and MUST respect the selected `NarrativeArc`'s required kind ordering (§15). `opening`/`context`/`problem` sequences MUST precede `demonstration`; `demonstration` MUST precede `proof`; `proof` MUST precede `outcome`; `conclusion` is always last when present.
- **Optional sequence removal**: a sequence with `required: false` MAY be omitted entirely under duration pressure (§18) provided no scene within it has `mustAppear: true`.
- **Merging rules**: `context` and `problem` sequences MAY be merged into one when combined scene count ≤ 2 and the arc does not require them distinct; merging MUST be recorded as a `StoryDecision` (`sequence-merged`). Merging combines scenes into one sequence's `sceneIds` list — it never causes a scene to belong to two sequences simultaneously (Decision 2).
- **Prohibited orderings**: a `proof` sequence MUST NOT precede its corresponding `demonstration` sequence; an `outcome` sequence MUST NOT appear with zero preceding `demonstration` or `proof` sequences.
- **Scene exclusivity**: every scene belongs to exactly one sequence (§9, Decision 2). Sequences that need to reference each other's narrative content do so exclusively through `StoryScene.dependsOnSceneIds`/`supportsSceneIds` and through `ProofChain` scene-id fields, which are permitted to span sequences (see "proof chain crossing" below) without violating scene exclusivity.
- **Hero Interaction span**: the Hero Interaction Sequence (§16) typically spans `demonstration` and `proof` sequence kinds — its `startSceneId` lives in `demonstration`, its `proofSceneIds` in `proof`, and its `resultSceneId` (if present) in `outcome`. It MUST NOT span into `opening`/`context`.
- **Proof chain crossing**: a `ProofChain` (§17) MAY reference scenes in different sequences (e.g., `contextSceneIds` in `context`, `proofSceneIds` in `proof`) — sequences group narrative purpose, not evidence chains, so proof chains are permitted to reference scenes across sequence boundaries as long as scene-level `dependsOnSceneIds` ordering is respected and each referenced scene still belongs to exactly one sequence.

---

## 13. Storyboard contract

```ts
// DRAFT CONTRACT
type Storyboard = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly sourceArtifactIds: readonly string[];
  readonly storyMode: "promotional" | "diagnostic";
  readonly audience: StoryAudience;
  readonly objective: StoryObjective;
  readonly narrativeArc: NarrativeArc;
  readonly beats: readonly NarrativeBeat[];
  readonly scenes: readonly StoryScene[];
  readonly sequences: readonly StorySequence[];
  readonly heroInteraction: HeroInteractionSequence | null;
  readonly proofChains: readonly ProofChain[];
  readonly durationBudget: StoryDurationBudget;
  readonly coverage: StoryCoverage;
  readonly rendererReadiness: RendererReadiness;
  readonly rejectedCandidates: readonly RejectedStoryCandidate[];
  readonly decisions: readonly StoryDecision[];
  readonly gate: StoryGate;
  readonly metrics: StoryMetrics;
};
```

`storyMode` is a **required v0.1 field**, not a placeholder or future discriminant — every `Storyboard` the reference compiler emits carries one of exactly two values, resolved during input normalization (§19 step 1, §26). `rendererReadiness` is likewise required and is a structured input to the single `StoryGate` (§9a, §25).

**ID stability**: `Storyboard.id` MUST be a deterministic function of `sourceArtifactIds` plus compiler `schemaVersion` (e.g., a content hash per the RFC-0001 `contentHashOf()` convention), not a random UUID — two compilations of the same inputs against the same compiler version MUST produce the same `Storyboard.id`. Beat, scene, and sequence ids MUST be stable slugs derived from their position in the deterministic candidate-generation order (e.g., `beat-proof-01`, `scene-demonstration-03`), not random.

**Serialization ordering**: `beats`, `scenes`, and `sequences` arrays MUST be serialized in their final compiled order (matching `StoryScene.order`/`StorySequence.order`), not candidate-generation order. `rejectedCandidates` and `decisions` MUST be serialized in deterministic generation order (§29).

**Canonical output**: exactly one `Storyboard` is produced per compilation (§14, Decision 14). Ranked alternatives, tournaments, and variant sets are out of scope for v0.1 (§39).

---

## 14. Audience and objective contracts

```ts
// DRAFT CONTRACT
type StoryAudience = {
  readonly role: string;
  readonly familiarity: "unfamiliar" | "aware" | "experienced";
  readonly technicalDepth: "low" | "medium" | "high";
  readonly primaryQuestion: string;
  readonly decisionContext: string;
  readonly knownConstraints: readonly string[];
};

type StoryObjective =
  | "explain" | "demonstrate" | "prove" | "compare"
  | "persuade-to-try" | "persuade-to-review" | "persuade-to-buy" | "document";
```

- `StoryAudience` MUST be sourced from the `StoryCompilerInput` (§27), which in turn MUST derive it from DIR `audience`/`goal` or an explicit caller-supplied override. The compiler MUST NOT infer demographic or psychographic detail beyond what is supplied — missing audience data MUST leave `StoryAudience` fields at documented defaults (`role: "unspecified"`, `familiarity: "aware"`, etc., to be finalized in the JSON Schema) rather than guessed values, and this MUST be recorded as a `warnings` entry in the Story Gate.
- Persuasive objectives still do not relax evidence rules — every invariant in §7–§9 applies identically regardless of `objective`.
- `objective` influences **ordering and inclusion** (e.g., persuasive objectives make `call-to-action` beats required, per the rule below), not **truth status** of any beat or scene.

### CTA requirement policy (Decision 4, normative for v0.1)

- A `call-to-action` beat/scene is **required** when `objective` is one of `persuade-to-try`, `persuade-to-review`, `persuade-to-buy`.
- It is **optional** when `objective` is one of `explain`, `demonstrate`, `prove`, `compare`, `document`.
- It is **never required** when `storyMode` is `"diagnostic"`, regardless of `objective`.
- A CTA scene MUST NOT introduce a claim or value proposition that is not already supported by an earlier scene in the same `Storyboard` (§9).

### Unsupported-impact policy cross-reference

Persuasive objective alone does not authorize an unverified `impact` beat into the selected story — see §22 for the full promotional-mode and diagnostic-mode policy, and §27 for the `"allow-unverified-impact"` constraint kind.

---

## 15. Narrative arc model

`NarrativeArc` is a closed reference set. The reference compiler MUST select from this list; it MUST NOT synthesize an arbitrary structure.

| Arc | Required beats (in order) | Optional beats | Valid categories | Selection condition | Rejection condition | Typical failure mode |
|---|---|---|---|---|---|---|
| `problem-solution-proof` | problem → product-introduction → interaction-start → interaction-complete → proof → result | hook, consequence, next-step, call-to-action | general, workflow, developer tool | default arc when a `problem` beat candidate with confidence ≥ 0.6 exists | no valid `problem` beat | proof arrives with no clear problem framing |
| `before-interaction-after` | current-state → interaction-start → interaction-complete → comparison → result | trust, call-to-action | before/after, workflow | strong `current-state` and `result` evidence pair exists | missing either current-state or result evidence | comparison lacks a genuine "before" |
| `goal-obstacle-resolution` | goal → problem → interaction-start → interaction-complete → result | consequence, next-step | consumer, workflow | `goal` beat confidence ≥ `problem` beat confidence | ambiguous goal vs. problem framing | goal and problem beats compete for the same slot |
| `diagnosis-intervention-result` | current-state → mechanism → interaction-start → interaction-complete → result | limitation, trust | infrastructure, diagnostic | interaction has clear diagnostic/corrective framing | interaction is not diagnostic in nature | forced diagnostic framing on a routine feature |
| `workflow-friction-compression` | problem (manual process) → interaction-start → interaction-complete → comparison → result | consequence, call-to-action | workflow | multiple manual-step observations precede one automated interaction | single-step interaction (no friction to compress) | comparison is manufactured rather than observed |
| `claim-demonstration-verification` | product-introduction → mechanism → interaction-start → interaction-complete → proof | trust, result | API, developer tool | central `Claim` with `evidenceIds` present drives the arc | no claim with linked evidence | demonstration without a specific claim to verify |
| `comparison-decision` | problem → comparison → interaction-start → interaction-complete → proof → result | call-to-action | comparison demo | ≥ 2 comparable evidenced options present | only one option has evidence | one-sided comparison |
| `capability-example-impact` | product-introduction → mechanism → interaction-start → interaction-complete → result → impact | trust, call-to-action | consumer, general | `impact` beat has verified or clearly-labeled-hypothesis backing per §22 | `impact` unsupported entirely and no `"allow-unverified-impact"` constraint is present | impact beat becomes unsupported speculation |

**Selection procedure**: candidate beats are generated first (§19 step 6); the arc selector (§28 `NarrativeArcSelector`) scores each arc by how many of its required beat kinds have at least one eligible candidate at `importance ≥ "important"`, picks the highest-scoring arc, and breaks ties by list order above (i.e., `problem-solution-proof` wins ties as the default/most general arc). If no arc reaches full required-beat coverage, the highest-scoring arc is still selected but the gap is recorded in `StoryCoverage` and MAY produce a `conditional` or `fail` Story Gate depending on which required beats are missing (§25).

**Arc override (Decision 12)**: `StoryCompilerInput.constraints` MAY supply an `arc-override` `StoryConstraint` naming one of the arcs above. An override MUST reference a valid declared arc; it MUST still satisfy every evidence and structural invariant in this document; it MUST NOT manufacture a missing required beat; it MUST produce `conditional` or `fail` when required arc elements cannot be supported by eligible evidence; and it MUST be recorded as a `StoryDecision` with `authority: "human"` or `"policy"` (never `"engine"`, since an override is by definition caller-supplied, not compiler-chosen).

---

## 16. Hero Interaction Sequence

```ts
// DRAFT CONTRACT
type HeroInteractionSequence = {
  readonly id: string;
  readonly sourceHeroInteractionId: string;   // ProductUnderstanding.selectedHeroInteraction.candidateId, or RFC-0003 heroInteraction id
  readonly narrativeAuthority: "human-selected" | "policy-selected" | "analysis-derived";
  readonly startSceneId: string;
  readonly progressSceneIds: readonly string[];
  readonly completionSceneId: string;
  readonly proofSceneIds: readonly string[];
  readonly resultSceneId: string | null;
  readonly continuityStatus: "complete" | "partial" | "broken";
  readonly verificationStatus: "verified" | "partially-verified" | "unverified" | "unverifiable";
  readonly alternativeVerifiedInteractionIds: readonly string[];
  readonly confidence: number;
};
```

### Authority model (Decision 6 — normative)

The governing principle is: **human authority selects narrative importance; evidence verifies demonstrability; the engine MUST NOT confuse these two responsibilities.**

1. An explicit human-authority Hero Interaction selection recorded in `ProductUnderstanding.selectedHeroInteraction` (with `authority: "human"`) is authoritative for **narrative importance** — i.e., it determines `sourceHeroInteractionId` and `narrativeAuthority: "human-selected"`.
2. `BrowserCaptureResult` evidence verifies whether that selected interaction is demonstrable and complete. This sets `verificationStatus` and, where the interaction cannot be fully observed, `continuityStatus`.
3. Browser evidence MAY invalidate or reduce the confidence/continuity of the human-selected Hero Interaction (e.g., `verificationStatus: "unverifiable"`, `continuityStatus: "broken"`). It MAY NOT change which interaction is narratively the hero.
4. Browser evidence MUST NOT silently replace a human-selected Hero Interaction merely because a *different* interaction completed successfully in capture. A technically-successful alternative interaction never acquires `narrativeAuthority` on its own.
5. `ExistingDemoAnalysis.heroInteraction` (RFC-0003) MAY supply the Hero Interaction candidate — with `narrativeAuthority: "analysis-derived"` — **only when no valid explicit human-authority RFC-0002 selection exists** (`ProductUnderstanding.selectedHeroInteraction` is `null`, or its `authority` is not `"human"`).
6. **If the human-selected interaction cannot be verified but a different interaction can**, the compiler MUST:
   - preserve the human selection as `sourceHeroInteractionId`/`narrativeAuthority: "human-selected"`;
   - record the alternative in `alternativeVerifiedInteractionIds`;
   - mark `continuityStatus` `"partial"` or `"broken"` as appropriate, and `verificationStatus` `"unverified"` or `"unverifiable"`;
   - produce `conditional` or `fail` Story Gate status depending on `objective` and claim criticality (§25);
   - allow replacement of the Hero Interaction only through an explicit, reversible `StoryDecision` with `authority: "human"` supplied via a `StoryConstraint` override — never automatically.
7. If no upstream source identifies a Hero Interaction (`ProductUnderstanding.selectedHeroInteraction` is `null` and no RFC-0003 candidate with `status: "identified"` exists), the compiler MUST NOT fabricate one: `Storyboard.heroInteraction` is `null`.

### Structural rules

- Scene ordering within the sequence MUST satisfy `order(startSceneId) < order(progressSceneIds[i]) < order(completionSceneId) < order(proofSceneIds[i]) < order(resultSceneId)` wherever each field is present — causal order is a hard invariant, not a preference.
- `completionSceneId` MUST NOT be ordered before `startSceneId`.
- Every scene in `proofSceneIds` MUST reference a state that follows `completionSceneId`; a proof scene cannot precede the state it proves.
- If `resultSceneId` is non-null, it MUST depend (via `StoryScene.dependsOnSceneIds`, transitively) on `completionSceneId` or a scene in `proofSceneIds`.
- Scenes not part of the Hero Interaction Sequence MUST NOT be interleaved between `startSceneId` and `completionSceneId` in final sequence order unless `whyThisSceneExists` on the interleaved scene explicitly justifies the interruption (e.g., a necessary side-panel context scene) AND that justification is recorded as a `StoryDecision`.
- `continuityStatus: "broken"` or a missing `completionSceneId` entirely MUST set the Story Gate to at least `conditional`, and to `fail` if `StoryObjective` is `prove` or `demonstrate`, or if the Hero Interaction backs a `critical` claim (see §25).

---

## 17. Proof Chain

```ts
// DRAFT CONTRACT
type ProofChain = {
  readonly id: string;
  readonly claimId: string;
  readonly contextSceneIds: readonly string[];
  readonly actionSceneIds: readonly string[];

  readonly evidenceRefIds: readonly string[];      // canonical: StoryEvidenceReference ids (§8)

  readonly sourceAssertionIds: readonly string[];   // browser-specific auditability: BrowserAssertionResult ids
  readonly sourceArtifactIds: readonly string[];    // browser-specific auditability: BrowserScreenshotArtifact/BrowserDomSnapshotArtifact ids

  readonly proofSceneIds: readonly string[];
  readonly resultSceneIds: readonly string[];

  readonly status: "verified" | "partial" | "unsupported";
  readonly gaps: readonly string[];
};
```

`evidenceRefIds` is the canonical, source-agnostic proof input (Decision 10): every `ProofChain` MUST resolve its evidentiary basis through `StoryEvidenceReference` records (§8), keeping `ProofChain` extensible to future non-browser evidence sources (documents, receipts, logs, metrics — see §39) without a contract change. `sourceAssertionIds` and `sourceArtifactIds` are retained **in addition to** `evidenceRefIds`, specifically to preserve browser-evidence auditability (direct traceability to `BrowserAssertionResult`/`BrowserScreenshotArtifact`/`BrowserDomSnapshotArtifact` ids) — they are not the canonical proof input and MUST NOT be relied upon by non-browser evidence sources.

### Rules

- `status: "verified"` REQUIRES at least one `evidenceRefIds` entry whose underlying `StoryEvidenceReference` is eligible for `role: "proof"` per §8, **and** whose source satisfies that source type's own verification rules. For browser-sourced evidence, this concretely means: at least one `sourceAssertionIds` entry with `status: "passed"`, linked to at least one `sourceArtifactIds` entry, and at least one `proofSceneIds` entry.
- `status: "partial"` covers: screenshot-only support (no passed assertion), or a passed assertion with no linked artifact, or missing `resultSceneIds` while proof itself is sound. A **screenshot-only chain is `"partial"` at best** — it can never reach `"verified"`.
- `status: "unsupported"` covers: no eligible evidence at all, or the only assertion available has `status: "failed"`. A **failed assertion cannot produce `"verified"` status** under any combination with other evidence, browser-sourced or otherwise.
- **Non-browser evidence sources** (future extension, §39) can achieve `status: "verified"` only via their own explicit, documented eligibility policy analogous to browser assertions — never by assumption that "some evidence exists" is sufficient.
- A `Claim` MAY have multiple `ProofChain`s (e.g., one per browser capture run, or one per evidence source type); the Storyboard MUST retain all of them, not collapse to the strongest. Multi-run precedence for *conflict resolution* purposes is governed by `BrowserCaptureSelectionPolicy` (§26), not by silently discarding weaker chains.
- Critical claims (referenced by a beat with `importance: "critical"`) REQUIRE at least one `ProofChain` with `status: "verified"` for the Storyboard to reach `pass` (§25).
- Duplicate evidence (the same `sourceAssertionIds`/`sourceArtifactIds`/`evidenceRefIds` cited in two different `ProofChain`s for the same claim) MUST NOT increase confidence automatically — `ProofChain.status` is evaluated per-chain from its own evidence set, and redundant chains do not stack.

---

## 18. Duration budget

```ts
// DRAFT CONTRACT
type StoryDurationBudget = {
  readonly targetMs: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly allocatedMs: number;
  readonly unallocatedMs: number;
  readonly overBudgetMs: number;
  readonly compressionApplied: boolean;
};
```

- **Duration input source**: `targetMs`/`minimumMs`/`maximumMs` come from `StoryCompilerInput.duration` (§27), which itself SHOULD be sourced from DIR `durationSeconds` when present.
- **No silent default (Decision 8)**: `StoryCompilerInput.duration` is a required field. If it is absent or invalid, the compiler MUST NOT invent a target duration — not 30s, not 60s, not any other value. Input validation fails with an `invalid-input` classification; a `StoryGate` artifact MAY still be emitted reporting `status: "fail"` with `blockingReasons: ["invalid-input: duration is required and was not supplied or was invalid"]`, but no `Storyboard` with a fabricated duration is produced. A future policy pack (§39) MAY supply an explicit, caller-opted-in default via a `StoryConstraint`, but the v0.1 reference implementation never does so implicitly.
- **Minimum readable scene duration**: a v0.1 reference policy constant of 1500 ms (§25) below which a scene cannot be compressed regardless of priority — text/state cannot register below this floor. This is a policy constant, not a schema-level universal invariant; see §25 for how breaching it is evaluated.
- **Maximum setup proportion**: `opening` + `context` + `problem` sequence durations combined SHOULD NOT exceed 25% of `targetMs` (v0.1 reference policy, evaluated per §25 — not an automatic blocking rule).
- **Hero Interaction minimum share**: the Hero Interaction Sequence's scenes SHOULD receive no less than 20% of `targetMs` when a Hero Interaction is present (v0.1 reference policy).
- **Proof minimum share**: `proof` sequence scenes SHOULD receive no less than 15% of `targetMs` when any critical claim requires proof (v0.1 reference policy).
- **CTA maximum share**: `call-to-action` scenes SHOULD NOT exceed 10% of `targetMs` (v0.1 reference policy).
- **Removal priority** (lowest priority removed first under compression): `supporting` priority, non-`mustAppear` scenes with the lowest `confidence` first; then `important` priority under the same rule; `critical` and `mustAppear` scenes are removal-protected (see §9).
- **Compression priority**: before removing any scene, the compiler MUST attempt to shrink `durationTargetMs` toward `durationRangeMs.minimum` for `supporting` and `important` scenes, in ascending priority order.
- **What happens when the story cannot fit**: if, after full compression and all eligible removals, `allocatedMs` (summed `mustAppear`/`critical` scene minimums) still exceeds `maximumMs`, the compiler MUST NOT silently truncate — it MUST set `overBudgetMs = allocatedMs - maximumMs`, leave `compressionApplied: true`, and the Story Gate MUST report `fail` with a `duration-infeasibility`-classified blocking reason (§25). Silent deletion of a `mustAppear` scene to force a fit is prohibited. This is the only duration-related path that produces `fail` — breaching a proportional target (setup/Hero Interaction/proof/CTA share) alone never does (§25).

---

## 19. Candidate generation

The reference pipeline is a deterministic, ordered sequence of pure stages. No stage may use randomness, wall-clock time (other than for non-semantic metadata), or external I/O.

1. **Normalize story inputs** — resolve `StoryCompilerInput` sources into a canonical internal representation with stable, sorted IDs (§29); resolve `storyMode` (§26) and the authoritative browser capture run per `BrowserCaptureSelectionPolicy` (§26) at this stage.
2. **Validate provenance** — confirm every referenced upstream artifact ID/run ID actually resolves within the supplied inputs; reject inputs with dangling references.
3. **Identify required claims** — union of DIR `EvidenceReference["claim"]` entries and `ProductUnderstanding.claims` flagged `importance: critical` (or equivalent).
4. **Identify verified evidence** — filter all Story Evidence References down to those meeting §8 eligibility per intended role.
5. **Identify Hero Interaction** — resolve per the §16 authority model (human-selected narrative importance vs. evidence-verified demonstrability).
6. **Generate candidate beats** — deterministically enumerate one candidate beat per eligible (kind, source-record) pairing per §6's valid-source-evidence column, applying the unsupported-impact policy (§22) to `impact` candidates.
7. **Reject unsupported beats** — apply §7 invariants; move failures to `rejectedCandidates`.
8. **Select narrative arc** — per §15 selection procedure (or apply an `arc-override` constraint).
9. **Build candidate scenes** — group surviving beats into scenes per the arc's structure, respecting §9 invariants (one primary beat, exclusive beat/scene ownership, evidence-backed proof/result linkage).
10. **Construct proof chains** — per §17, from scenes carrying `proof`/`result` beats, resolved against normalized `evidenceRefIds`.
11. **Order dependencies** — topologically sort scenes/sequences by `dependsOnSceneIds` and arc-required kind ordering; reject on cycle detection.
12. **Apply duration budget** — per §18.
13. **Calculate coverage** — per §23.
14. **Compute renderer readiness** — per §9a/§25, from scene-level artifact/evidence availability.
15. **Compute Story Gate** — per §25, incorporating renderer readiness.
16. **Emit decisions and rejected candidates** — per §21/§20.

The reference implementation MUST NOT use free-form generative creativity at any stage — every candidate is produced by a documented rule against a documented source, not by open-ended synthesis.

---

## 20. Selection and prioritization algorithm

### Scoring dimensions (conceptual, not premature numerical precision)

- **Requirement criticality** — is this claim/beat required by the selected arc or DIR?
- **Evidence verification** — `verified` > `partially-verified` > `unverified`.
- **Claim importance** — `critical` > `important` > `supporting`.
- **Hero Interaction relevance** — is this candidate part of the protected Hero Interaction Sequence?
- **Audience relevance** — does `StoryAudience.technicalDepth`/`primaryQuestion` favor this candidate over a competing one?
- **Causal necessity** — is this candidate required to satisfy a downstream scene's `dependsOnSceneIds`?
- **Uniqueness** — does this candidate cover a claim/beat kind not already covered by a higher-scoring candidate?
- **Redundancy penalty** — a second candidate covering an already-satisfied beat kind/claim scores lower.
- **Uncertainty penalty** — lower confidence, lower score.
- **Duration cost** — candidates with lower `durationTargetMs` per unit of coverage are favored under budget pressure.
- **Upstream confidence** — the source record's own `confidence`/`ConfidenceSummary` value.

**Conceptual formula** (illustrative, not to be treated as final): `score = w1·criticality + w2·verification + w3·importance + w4·heroRelevance + w5·causalNecessity + w6·uniqueness − w7·redundancy − w8·uncertainty − w9·durationCost`, with weights fixed constants documented in the implementation, not user-tunable in v0.1. Precise weight values are an implementation detail to be finalized during development, not fixed by this RFC — this section fixes the **dimensions**, not the coefficients.

Every **selected** scene MUST record, in `whyThisSceneExists` and its linked `StoryDecision`: positive selection reasons, supporting `sourceArtifactIds`, `confidence`, and its required narrative role (which beat kind(s) it satisfies).

Every **rejected candidate** MUST be recorded as:

```ts
// DRAFT CONTRACT
type RejectedStoryCandidate = {
  readonly id: string;
  readonly candidateType: "beat" | "scene";
  readonly candidateSnapshot: unknown;   // the rejected beat/scene as generated, for audit
  readonly reasonCode: RejectionReasonCode;
  readonly explanation: string;
  readonly conflictingWithIds: readonly string[];
  readonly replacedByIds: readonly string[];
};

type RejectionReasonCode =
  | "unsupported" | "duplicate" | "low-confidence" | "non-critical"
  | "duration-budget" | "dependency-missing" | "conflicts-with-hero"
  | "sequencing-invalid" | "audience-mismatch" | "claim-not-required"
  | "stronger-evidence-selected" | "incomplete-proof-chain"
  | "forbidden-in-current-arc" | "unsupported-impact" | "capture-conflict-unresolved";
```

**Invalid-case example:** two candidate `proof` scenes exist for the same claim — one from a passing browser assertion (verified), one from an `ExistingDemoAnalysis` observation (partially-verified, same claim). The weaker candidate is rejected with `reasonCode: "stronger-evidence-selected"`, `replacedByIds: [<verified scene id>]`.

---

## 21. Story decisions

```ts
// DRAFT CONTRACT — structurally aligned with RFC-0001 DecisionRecord
type StoryDecision = {
  readonly decisionId: string;
  readonly runId: string;
  readonly createdAt: string;          // ISODateTime; excluded from semantic diffing, see §29
  readonly engine: "story-engine";
  readonly question: string;
  readonly options: readonly { readonly id: string; readonly label: string; readonly tradeoffs?: readonly string[] }[];
  readonly chosenOptionId: string;
  readonly reason: string;
  readonly confidence: number;
  readonly authority: "human" | "engine" | "policy";
  readonly reversible: boolean;
  readonly reasonCodes: readonly string[];
};
```

`StoryDecision` MUST be either a literal reuse of RFC-0001's `DecisionRecord` (extended with `reasonCodes`) or a structurally-mapped equivalent consumable by the same `DecisionLog`/`decisions.json` mechanism used by RFC-0002–0004 engines.

### Decision kinds requiring an entry

`story-mode-resolved`, `capture-run-selected`, `audience-selected`, `objective-selected`, `narrative-arc-selected`, `arc-override-applied`, `beat-selected`, `beat-rejected`, `scene-selected`, `scene-rejected`, `sequence-merged`, `sequence-removed`, `proof-chain-accepted`, `proof-chain-rejected`, `duration-compressed`, `hero-interaction-resolved`, `hero-interaction-override-applied`, `unverified-impact-admitted`, `renderer-readiness-computed`, `story-gate-computed`.

Each entry MUST include input references (source artifact/item IDs), the rule applied (a cross-reference to the relevant RFC-0005 section, e.g. `"§9 causal-necessity invariant"`), alternatives considered, the selected outcome, confidence, reversibility, and deterministic ordering (§29) in place of wall-clock sequencing for comparison purposes.

**Aggregation rule**: individual `beat-rejected`/`scene-rejected` decisions for the same `reasonCode` against the same replacement MAY be aggregated into one `StoryDecision` with multiple `candidateSnapshot` references in `RejectedStoryCandidate`, rather than one verbose decision per rejected item, when the rule applied is identical across all of them.

---

## 22. Contradiction handling

| Scenario | Principle applied | Outcome |
|---|---|---|
| Two facts conflict (e.g., two `Fact` records disagree) | Verified direct evidence outranks unsupported narrative declarations | The `Fact` with stronger `verificationStatus` is used; the weaker is recorded in `uncertaintyNotes` on any beat that would have used it, not silently dropped |
| Claim confidence differs across sources | Preserve provenance for both | Beat cites the source with the highest `verificationStatus`; a divergence note is recorded when the gap is large (implementation-defined threshold) |
| Capture contradicts manifest (e.g., DIR/manifest asserts a behavior, `BrowserCaptureResult` assertion fails) | Verified capture evidence outranks manifest assertion | The failed assertion wins; any beat claiming the manifest's version MUST be rejected (`reasonCode: unsupported`) — see the failed-assertion policy below for whether this additionally produces a *selected* limitation beat |
| Existing-demo analysis contradicts browser evidence | Direct verification (capture) outranks retrospective analysis | Browser evidence is authoritative for product-behavior claims; analysis findings remain valid for narrative-quality context only, and never as proof of the new story's quality |
| Screenshot and assertion disagree (assertion fails on a screen that "looks" successful) | Assertion (typed check) outranks visual impression | `status: failed` on the assertion is authoritative regardless of screenshot appearance |
| Hero Interaction selection differs between RFC-0002 and RFC-0003 | Resolved by the §16 authority model | Recorded as a `hero-interaction-resolved` decision; see §16 — human-authority selection always wins for narrative importance |
| Required claim has failed evidence | See the failed-assertion policy below | Gate impact is mandatory; a *selected* limitation scene is mode-dependent, not automatic |
| Result exists without visible cause | Structural invariant, not a contradiction per se | Rejected per §9's causal-necessity invariant |
| Multiple `BrowserCaptureResult` runs disagree on the same claim | Resolved by `BrowserCaptureSelectionPolicy` (§26) | See §26 — never resolved by input array order |

### Failed-assertion and limitation-beat policy (Decision 3, normative)

**Promotional mode** (`storyMode: "promotional"`):

- A failed assertion for a **critical required claim** blocks that claim's `ProofChain` from reaching `status: "verified"` (§17).
- It MUST affect the `Storyboard.gate` — at minimum recorded in `StoryGate.warnings` or `blockingReasons` depending on criticality (§25).
- It MUST be recorded in the relevant contradiction handling, `rejectedCandidates`, `decisions`, and (when it blocks a critical claim from `pass`) `StoryGate.requirementsBeforeRender`.
- It does **NOT** automatically force a *selected* `limitation` scene into the Storyboard.
- A `limitation` scene MAY be selected in promotional mode only when doing so genuinely improves an honest explanatory or recovery narrative (e.g., the arc benefits from acknowledging a constraint) — this is a normal §20 scoring decision like any other candidate, not a mandatory insertion.

**Diagnostic mode** (`storyMode: "diagnostic"`):

- A failed assertion relevant to the diagnostic objective MUST generate or select a `limitation` beat — this is mandatory, not optional, because the diagnostic mode's purpose is to surface exactly this kind of finding.
- A critical observed failure MUST be visible in the diagnostic Storyboard; it MUST NOT be omitted for narrative tidiness.
- Diagnostic mode MAY honestly conclude with a `limitation` beat rather than a successful `result` beat — this is a valid, non-failing narrative shape in diagnostic mode (see the diagnostic arc example in §6).

**Non-critical failures** (either mode):

- MAY create `limitation` candidates.
- MUST NOT automatically become selected scenes; ordinary §20 scoring applies, except where the diagnostic-mode mandatory rule above applies.

### Unsupported-impact policy (Decision 11, normative)

**Promotional mode:**

- An `impact` beat sourced only from a `Hypothesis` or an otherwise-unsupported `Claim` MUST remain a candidate or `RejectedStoryCandidate` by default.
- It MUST NOT be selected merely because it is labeled `verificationStatus: "unverified"` — unverified labeling is a description of the evidence, not a license to include it.
- It MUST NOT satisfy required or critical `StoryCoverage`.
- It MAY be selected only when `StoryCompilerInput.constraints` contains an explicit `{ kind: "allow-unverified-impact", ... }` constraint (§27) authorizing unverified impact framing for this compilation.
- Even under that constraint, the selected beat MUST remain visibly marked `verificationStatus: "unverified"` with populated `uncertaintyNotes`, and its presence can contribute to at most a `conditional` Story Gate — never `pass` — and it never counts toward critical claim coverage.

**Diagnostic mode:**

- An unverified `impact` hypothesis MAY appear as a clearly labeled hypothesis or investigation target without requiring the `"allow-unverified-impact"` constraint (diagnostic mode's purpose already presumes surfacing uncertainty).
- It does not count as a verified `result` or `proof` regardless of mode.

### Core principles

- The engine MUST NOT silently choose the more flattering source.
- An unresolved **critical** contradiction MUST fail the Story Gate.
- A **non-critical** contradiction MAY produce a `limitation` beat candidate or a `conditional` gate instead of blocking entirely.
- All conflicting provenance MUST be preserved in the `Storyboard` (via `uncertaintyNotes`, `RejectedStoryCandidate`, and `StoryDecision.options`/`tradeoffs`), never deleted for tidiness.

---

## 23. Story coverage

```ts
// DRAFT CONTRACT
type StoryCoverage = {
  readonly requiredClaimCount: number;
  readonly coveredClaimCount: number;
  readonly criticalClaimCount: number;
  readonly coveredCriticalClaimCount: number;
  readonly requiredBeatCount: number;
  readonly satisfiedBeatCount: number;
  readonly verifiedProofChainCount: number;
  readonly partialProofChainCount: number;
  readonly unsupportedClaimCount: number;
  readonly unverifiedImpactBeatsAdmittedCount: number;
  readonly heroInteractionCovered: boolean;
  readonly resultCovered: boolean;
  readonly ctaRequired: boolean;
  readonly ctaCovered: boolean;
  readonly narrativeCoverageRatio: number;   // [0,1]
  readonly proofCoverageRatio: number;       // [0,1]
  readonly sufficient: boolean;
};
```

Ratios MUST NOT hide critical missing elements: `sufficient` MUST be `false` whenever `coveredCriticalClaimCount < criticalClaimCount`, `heroInteractionCovered` is `false` while a Hero Interaction was expected, or `resultCovered` is `false` while the arc requires a `result` beat — regardless of how high `narrativeCoverageRatio` computes numerically. A high ratio with a missing critical element MUST still report `sufficient: false`. `unverifiedImpactBeatsAdmittedCount` MUST always be reported (even when zero) so that any `"allow-unverified-impact"`-driven inclusion is visible in coverage, not just in decisions.

---

## 24. Story metrics

```ts
// DRAFT CONTRACT
type StoryMetrics = {
  readonly narrativeCompleteness: number;      // [0,1], decomposes into StoryCoverage fields
  readonly proofDensity: number;                // verified proof chains / total scenes
  readonly evidenceUtilization: number;         // evidence refs used / evidence refs available
  readonly redundancy: number;                  // count of rejected "duplicate" candidates / total candidates
  readonly setupRatio: number;                  // setup sequence duration / targetMs
  readonly interactionRatio: number;
  readonly proofRatio: number;
  readonly resultRatio: number;
  readonly unsupportedClaimCount: number;
  readonly transitionCoherence: number;          // fraction of transitions matching §11 valid-neighbor rules
  readonly sceneCount: number;
  readonly sequenceCount: number;
  readonly durationFit: number;                  // allocatedMs / targetMs
  readonly heroInteractionContinuity: "complete" | "partial" | "broken" | "absent";
  readonly rejectionCountByReason: Readonly<Record<RejectionReasonCode, number>>;
};
```

RFC-0005 explicitly does **not** define a single opaque "creative quality score." If any aggregate score is proposed in a future revision, it MUST remain secondary to this decomposed metrics set and MUST be fully derivable from these fields (i.e., reproducible from data already present, not an independent judgment).

---

## 25. Story Gate

```ts
// DRAFT CONTRACT
type StoryGateStatus = "pass" | "conditional" | "fail";

type StoryGate = {
  readonly status: StoryGateStatus;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly requirementsBeforeRender: readonly string[];
};
```

(Field name `requirementsBeforeRender` chosen to match the RFC-0002 `UnderstandingGate` convention, since the Story Gate's consumer is the render step.)

**Story Gate is the single gate defined by RFC-0005.** `RendererReadiness` (§9a, defined fully below) is a structured dimension consumed by this one gate — it is not a second, independently-published gate in v0.1. RFC-0006 MAY later define its own Render Gate that consumes `StoryGate`/`RendererReadiness` as inputs, without this RFC's semantic story contract changing.

```ts
// DRAFT CONTRACT
type RendererReadinessStatus = "ready" | "recapture-required" | "blocked";

type RendererReadiness = {
  readonly status: RendererReadinessStatus;
  readonly readySceneIds: readonly string[];
  readonly recaptureRequiredSceneIds: readonly string[];
  readonly blockedSceneIds: readonly string[];
  readonly missingArtifactIds: readonly string[];
  readonly recaptureRequirements: readonly string[];
  readonly reasons: readonly string[];
};
```

Rules governing `RendererReadiness`:

- Critical scenes marked `"blocked"` cause `StoryGate: fail` (no exceptions).
- Non-critical `"recapture-required"` scenes MAY produce `conditional` only.
- Every critical scene MUST be either `"ready"` or have an admissible critical recapture plan (recorded in `recaptureRequirements`) to avoid blocking the gate.
- `RendererReadiness` evaluates **artifact/evidence availability only** — it does NOT evaluate visual polish, aesthetic quality, or rendering craft; those remain entirely out of scope for RFC-0005 and belong to RFC-0006.

### PASS requires

- Valid upstream inputs (all referenced artifact/run IDs resolve; no dangling provenance).
- No unresolved critical contradiction (§22), including no unresolved critical multi-capture-run conflict (§26).
- The selected narrative arc's required beats are all present and satisfied.
- Hero Interaction is `continuityStatus: "complete"` whenever a human-selected Hero Interaction exists (§16), or is `null` when genuinely none exists upstream.
- All critical claims are covered (`coveredCriticalClaimCount === criticalClaimCount`), with no critical claim covered only by an unverified `impact` beat admitted under `"allow-unverified-impact"` (§22).
- At least one `verified` proof chain exists for every critical demonstrated claim.
- `resultCovered` is `true` whenever the arc promises a result.
- Duration fits the permitted range (`allocatedMs` within `[minimumMs, maximumMs]`) or was validly compressed to fit.
- All scene dependencies resolve (no dangling `dependsOnSceneIds`).
- No scene with `priority: "critical"` is `unsupported`.
- `RendererReadiness.status` is not `"blocked"` for any critical scene, and every critical scene is either `"ready"` or has an admissible `"recapture-required"` plan (§9a above).
- If `storyMode: "promotional"`: the upstream gate policy in §26 is satisfied (no prohibited upstream-gate state).

### CONDITIONAL examples

- A non-critical claim is omitted.
- CTA is weak, generic, or entirely optional and absent (when not required by objective/mode, §14).
- Partial (not verified) proof exists for a supporting (not critical) claim.
- Minor duration compression was applied without removing any `mustAppear` scene.
- An optional sequence is missing.
- A low-confidence `context` scene remains in the storyboard.
- `result` exists but the generalized `impact` beat remains unverified (with or without the `"allow-unverified-impact"` constraint, per §22 — this is the ceiling for such beats, never `pass`).
- A non-critical scene has `RendererReadiness.status: "recapture-required"`.
- A non-critical multi-capture-run conflict remains unresolved (§26).
- A promotional-mode failed assertion on a non-critical claim exists without a selected limitation scene.
- A proportional duration policy (setup ≤ 25%, Hero Interaction ≥ 20%, proof ≥ 15%, CTA ≤ 10%, minimum scene ≥ 1500ms) is breached but the storyboard remains structurally readable and fits its duration range — proportional-policy breaches alone are never blocking (§18).

### FAIL examples

- No valid story arc reaches minimum required-beat coverage.
- Missing critical proof (no `verified` `ProofChain` for a critical claim).
- Hero Interaction is `"broken"` while required, or was silently replaced without an explicit override decision.
- An unresolved critical contradiction exists (§22), including an unresolved critical multi-capture-run conflict under `"reject-conflict"` fallback (§26).
- An unsupported critical claim remains in the storyboard.
- A `result` beat/scene is present with no valid upstream cause (fabricated result).
- Scene or sequence dependencies are cyclic.
- Storyboard remains over budget after full compression with no valid further compression (§18) — this is the only duration-related `fail` path; missing a proportional target alone never causes `fail`.
- `RendererReadiness.status: "blocked"` for any critical scene, with no admissible recapture plan.
- Any referenced source ID fails to resolve.
- A critical claim is represented only by transcript text or narrative declaration with no visual/state corroboration.
- A `proof` scene is ordered before the `cause` scene it is meant to prove.
- The storyboard is empty (zero scenes).
- An upstream gate (`UnderstandingGate`, `ExistingDemoAnalysisGate`, `BrowserCaptureGate`) reports a prohibited state under the §26 policy for the resolved `storyMode`.
- `StoryCompilerInput.duration` was absent or invalid (§18, §27) — classified `invalid-input`.

### Failure category taxonomy

To keep gate decisions explainable, every `blockingReasons` entry MUST be classifiable into exactly one of: `invalid-input`, `insufficient-evidence`, `incomplete-narrative`, `duration-infeasibility`, `unsupported-claim`, `structural-failure`, `renderer-readiness-failure`. This classification SHOULD be encoded as a prefix or field on each blocking reason string (exact serialization left to the JSON Schema, §33) so downstream tooling can group failures without re-deriving the category from prose.

### Numeric narrative policies (v0.1 reference policy constants)

The following are explicit v0.1 reference policies, not universal creative truths and not independently blocking:

- setup target ≤ 25% of `targetMs`
- Hero Interaction target ≥ 20% of `targetMs` when present
- proof target ≥ 15% of `targetMs` when critical proof is required
- CTA target ≤ 10% of `targetMs`
- reference readable-scene target ≥ 1500 ms

These ratios normally generate `StoryMetrics` values, `StoryGate.warnings`, or `conditional` status — never `fail` on their own. Breaching a ratio becomes blocking only when the resulting storyboard is structurally unreadable, loses a `mustAppear`/critical scene, breaks causal order, or cannot fit within the declared duration range — in which case the `fail` is attributed to the underlying structural or duration-infeasibility cause (§18), not to the missed percentage. A scene below the 1500 ms policy target MAY still be `conditional` if it remains renderer-usable. A storyboard whose critical content cannot be made readable within the duration budget fails for `duration-infeasibility`, never because a proportion was missed.

---

## 26. Upstream gate policy

### `storyMode` resolution (Decision 7)

`storyMode` is resolved once, during input normalization (§19 step 1), from `StoryCompilerInput.constraints`: a constraint of `{ kind: "mode", value: "diagnostic" }` resolves `storyMode: "diagnostic"`; its absence resolves `storyMode: "promotional"` (the default). The resolved value is written to `Storyboard.storyMode` and is immutable for the remainder of that compilation. There is one common `Storyboard` contract for both modes (§13) — v0.1 does not define two duplicated contracts; behavior differs only through the mode-conditional rules in this document (§14, §22, §25, this section).

### Upstream gate table (final, Contradiction C resolved)

| Upstream gate | Story Engine response |
|---|---|
| `UnderstandingGate: fail` | **Blocks compilation** (`StoryGate: fail`) when `storyMode: "promotional"`. When `storyMode: "diagnostic"`, compilation MAY proceed — a failed Understanding Gate is itself diagnosable content. |
| `UnderstandingGate: conditional` | Compilation proceeds in either mode; every warning MUST propagate into `StoryGate.warnings`. |
| `ExistingDemoAnalysisGate: fail` | **Does not automatically block** Story compilation in either mode. Its findings MAY be used only according to the `analysis-finding` evidence eligibility rules (§8); it MUST NOT be used as evidence that the *new* Storyboard is of good quality. |
| `ExistingDemoAnalysisGate: conditional`/`pass` | Findings usable per §8 eligibility (`analysis-finding` sourceType, `context`-role only). |
| `BrowserCaptureGate: fail` (for a given run) | That run **cannot supply a `verified` `ProofChain`**. It MAY provide `limitation`/diagnostic evidence per §22's failed-assertion policy. It does **not automatically fail the whole Storyboard** if another admissible source (a different, passing capture run, or otherwise-eligible evidence) proves all required critical claims. Absence of *any* admissible source of critical proof, across all supplied runs, causes `StoryGate: fail`. |
| `BrowserCaptureGate: conditional`/`pass` | Standard eligibility rules (§8) apply. |

### Multiple capture runs (Decision 5, `BrowserCaptureSelectionPolicy` — normative, replaces all prior array-order/"first element"/"latest run" wording)

```ts
// DRAFT CONTRACT
type BrowserCaptureSelectionPolicy = {
  readonly authoritativeRunId?: string;
  readonly fallback:
    | "latest-captured-at"
    | "highest-gate-status"
    | "reject-conflict";
};
```

`BrowserCaptureSelectionPolicy` is a field on `StoryCompilerInput` (§27). Normative behavior:

1. If `authoritativeRunId` is supplied and resolves to one of the supplied `browserCaptures` entries, that run is authoritative for any conflict between runs.
2. If `authoritativeRunId` is missing or does not resolve, apply `fallback`.
3. The default `fallback` for v0.1, when `BrowserCaptureSelectionPolicy` itself is omitted entirely from `StoryCompilerInput`, is `"latest-captured-at"`.
4. Under `"latest-captured-at"`, each `BrowserCaptureResult`'s `capturedAt`/completion timestamp determines recency; the most recent run is authoritative for conflicts.
5. `runId` is used **only** as a deterministic tie-breaker when two runs' recency timestamps are exactly equal — it never independently confers authority, and it is never conflated with "latest."
6. **The input array order of `browserCaptures` MUST NOT carry semantic authority.** No rule in this document may treat "first element" or "array position" as a precedence signal; any such prior wording is superseded by this section.
7. All supplied runs remain preserved in `Storyboard` provenance (`StoryEvidenceReference.sourceRunId`, §8) and in `StoryDecision` records (`capture-run-selected`) — the non-authoritative runs are not deleted, only deprioritized for conflict resolution.
8. A more recent **failed** assertion MUST NOT be hidden by an older successful run — recency authority under `"latest-captured-at"` applies symmetrically to failures and successes; a newer failure surfaces, it does not get silently outvoted by an older pass.
9. An unresolved conflict affecting **critical** proof MUST fail the Story Gate.
10. A non-critical unresolved conflict MAY produce `conditional`.
11. Under `"highest-gate-status"`, the run with the best `BrowserCaptureGate.status` (`pass` > `conditional` > `fail`) MAY be selected to supply *non-conflicting* coverage (i.e., claims only that run addresses), but this fallback MUST NOT be used to erase or override contradictory evidence from another run about the *same* claim — a genuine conflict on the same claim still requires resolution via rules 8–10, not simply picking the "better" run's answer.
12. Under `"reject-conflict"`, compilation is blocked (`invalid-input`/`fail`, per the caller's intent to treat any disagreement as unacceptable) whenever two or more supplied runs disagree on the same claim, regardless of criticality.

---

## 27. Input contract

```ts
// DRAFT CONTRACT
type StoryConstraint =
  | { readonly kind: "mode"; readonly value: "diagnostic"; readonly reason: string }
  | { readonly kind: "max-scene-duration"; readonly value: number; readonly reason: string }
  | { readonly kind: "cta-required"; readonly value: boolean; readonly reason: string }
  | { readonly kind: "hero-interaction-required"; readonly value: boolean; readonly reason: string }
  | { readonly kind: "arc-override"; readonly value: NarrativeArc; readonly reason: string }
  | { readonly kind: "allow-unverified-impact"; readonly value: { readonly claimId?: string }; readonly reason: string };

type StoryCompilerInput = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly productUnderstanding: ProductUnderstanding;
  readonly dir: DemoIntermediateRepresentation;
  readonly existingDemoAnalysis?: ExistingDemoAnalysis;
  readonly browserCaptures: readonly BrowserCaptureResult[];
  readonly captureSelectionPolicy?: BrowserCaptureSelectionPolicy;
  readonly audience: StoryAudience;
  readonly objective: StoryObjective;
  readonly duration: {
    readonly targetMs: number;
    readonly minimumMs: number;
    readonly maximumMs: number;
  };
  readonly constraints: readonly StoryConstraint[];
};
```

- **Required**: `productUnderstanding`, `dir`, `audience`, `objective`, `duration`. `duration` MUST be present and valid — there is no silent default (§18, Decision 8). `browserCaptures` MAY be an empty array (a Storyboard MAY reach at most `conditional`/`fail` — never `pass` on critical proof — without browser evidence, since screenshots/DOM alone cannot verify function per §8).
- **Optional**: `existingDemoAnalysis`, `captureSelectionPolicy` (defaults per §26 rule 3 when omitted), `constraints` (defaults to `[]`, which resolves `storyMode: "promotional"` per §26).
- **Compatibility**: `productUnderstanding.schemaVersion` MUST be `"0.2"`, `dir.schemaVersion` MUST be `"0.2"`, `existingDemoAnalysis.schemaVersion` MUST be `"0.1"`, each `browserCaptures[i].schemaVersion` MUST be `"0.1"` — a mismatch is an `invalid-input` compile failure, not a warning (per the project's existing single-schema-per-artifact convention).
- **Precedence**: when `dir` and `productUnderstanding` disagree on required claims, DIR is authoritative for *what the demo must accomplish*; `productUnderstanding` is authoritative for *what is actually true*. A DIR-required claim with no `productUnderstanding` backing is a §22-style contradiction (`insufficient-evidence`), not silently satisfied by DIR's assertion alone.
- **Run identity checks**: every `browserCaptures[i].capturePlanId`/`targetId` MUST correspond to a target referenced (directly or transitively via evidence bridge, per RFC-0004 §"ProductUnderstanding evidence bridge") within the supplied `productUnderstanding`. Non-corresponding entries are rejected at validation (`invalid-input`). If `captureSelectionPolicy.authoritativeRunId` is supplied, it MUST correspond to one of the supplied `browserCaptures` entries' `runId`, or validation fails (`invalid-input`).
- **`"allow-unverified-impact"` constraint**: MAY optionally scope to a single `claimId`; when `claimId` is omitted, the authorization applies to any `impact` beat candidate otherwise blocked solely by the unsupported-impact policy (§22). This constraint has no effect in diagnostic mode (already permitted there) and no effect on `proof`/`result` beat eligibility (§8) — it authorizes `impact` beats only.

---

## 28. StoryCompiler output and engine responsibilities

Proposed pure, stateless components (I/O — reading YAML, writing artifacts — stays entirely outside these, in the future CLI layer per §32, matching the RFC-0002–0004 `Engine<I,O>` pattern):

- **`StoryInputNormalizer`** — pure function: `StoryCompilerInput → NormalizedStorySources`. Resolves `storyMode` (§26) and the authoritative capture run per `BrowserCaptureSelectionPolicy` (§26) as part of normalization.
- **`NarrativeBeatSelector`** — pure function: `NormalizedStorySources → { candidates: NarrativeBeat[], rejected: RejectedStoryCandidate[] }`. Applies the unsupported-impact policy (§22) to `impact` candidates.
- **`NarrativeArcSelector`** — pure function: `NarrativeBeat[] → { arc: NarrativeArc, coverage: Partial<StoryCoverage> }`. Honors an `arc-override` constraint when present (§15).
- **`SceneCompiler`** — pure function: `(NarrativeBeat[], NarrativeArc) → { scenes: StoryScene[], rejected: RejectedStoryCandidate[] }`. Enforces exclusive beat ownership (Decision 1).
- **`SequenceCompiler`** — pure function: `(StoryScene[], NarrativeArc) → StorySequence[]`. Enforces exclusive scene ownership (Decision 2).
- **`DurationAllocator`** — pure function: `(StoryScene[], StorySequence[], budget) → { scenes: StoryScene[], durationBudget: StoryDurationBudget }`.
- **`RendererReadinessEvaluator`** — pure function: `(StoryScene[], evidence availability) → RendererReadiness` (§9a, §25).
- **`StoryGateEvaluator`** — pure function: `(Storyboard-in-progress, RendererReadiness) → StoryGate`.
- **`StoryboardCompiler`** — pure function composing the above into a full `Storyboard`, including `storyMode` and `rendererReadiness`.
- **`StoryEngine`** — orchestration wrapper implementing the RFC-0001 `Engine<StoryCompilerInput, Storyboard>` interface (`validate`, `run`, `verify`, `metrics`, `decisionsFromLastRun`), matching the existing engine convention used by RFC-0002–0004.

### Pipeline (engine responsibility list)

1. validate input
2. normalize provenance (including `storyMode` and capture-run selection)
3. generate candidates
4. select beats
5. choose arc
6. construct scenes
7. construct sequences
8. protect Hero Interaction (per the §16 authority model)
9. build proof chains
10. allocate duration
11. compute coverage and metrics
12. compute renderer readiness
13. evaluate Story Gate
14. emit decisions
15. verify output

Steps 1–13 (excluding orchestration bookkeeping) MUST be pure deterministic functions with no I/O; only the CLI layer (§32) performs file/network I/O, matching `capture-browser.ts`'s existing separation of engine logic from CLI plumbing.

---

## 29. Determinism

- **Stable source ordering**: story sources are processed in a fixed order — `productUnderstanding` fields first (in their own declared array order), then `dir`, then `existingDemoAnalysis` if present, then `browserCaptures` in input-array order for enumeration purposes only (per §26, array order carries no semantic authority for conflict resolution, but a fixed enumeration order is still required for deterministic candidate-ID generation).
- **Stable candidate IDs**: generated as deterministic slugs from `(sourceType, sourceItemId, sourceRunId, beatKind)` tuples, not random UUIDs or counters seeded by wall-clock time.
- **Stable tie-breaking**: ties in scoring (§20) are broken first by `requirementCriticality`, then by `sourceItemId` lexical order — never by insertion order alone, which could vary across otherwise-equivalent input serializations. Capture-run recency ties are broken by `runId` lexical order (§26 rule 5).
- **Stable scene ordering**: fixed by the arc's required beat-kind order, then by `sourceItemId` lexical order within the same kind.
- **Stable rejection reasons**: the same input MUST always produce the same `reasonCode` for the same rejected candidate.
- **Stable JSON key/array policies**: object keys serialize in the order declared by the TypeScript contract (matching existing RFC-0001–0004 artifact conventions); arrays never reorder based on Map/Set iteration order — sort explicitly before serializing.
- **Timestamps isolated from semantic comparison**: `createdAt` on `StoryDecision`, `capturedAt` used only for display, and any per-run metadata MUST be excluded from equality/golden-fixture comparison (test harness compares all fields except timestamp fields), consistent with how RFC-0001–0004 already isolate `createdAt`/`runId` from content hashing. Note that `capturedAt` **is** semantically significant for `BrowserCaptureSelectionPolicy` recency resolution (§26) — it is excluded only from golden-fixture *output* comparison, not from compilation logic.
- **No random selection, no locale-sensitive ordering** (string sorts MUST use ordinal/codepoint comparison, not locale collation), **no hidden environment dependence, no model calls** in the reference implementation.

### Allowed nondeterministic metadata (documented separately, excluded from determinism guarantees)

`runId`, `createdAt`/`ISODateTime` fields, and `ArtifactEnvelope.contentHash` (which is itself a deterministic function of payload but naturally varies if payload varies) — these are metadata about *when/which run produced this*, not semantic content, and MUST be excluded from any "is this storyboard the same" comparison.

---

## 30. Renderer boundary

### RFC-0005 supplies to RFC-0006

- Ordered scenes (`StoryScene[]` in final compiled order).
- Duration targets and ranges per scene.
- Evidence/artifact references (`StoryEvidenceReference[]`, resolvable back to RFC-0004 screenshot/DOM artifacts; `ProofChain.sourceAssertionIds`/`sourceArtifactIds` for browser-specific traceability).
- Semantic presentation intent (`ScenePresentationIntent`).
- Transition intent (`StoryTransitionIntent`).
- Text/voice *purpose* (`textIntent`, `voiceIntent` — semantic categories, not prose; see §13's text/voice boundary).
- Must-show and must-not-show constraints (`mustAppear`, `mustNotAppearWith`).
- Proof-chain requirements (`ProofChain[]`, so the renderer knows which visual elements must be legible for a scene to actually prove its claim).
- Confidence and uncertainty (`confidence`, `uncertaintyNotes`).
- `storyMode` (§13) — so the renderer never mistakes a diagnostic storyboard for a promotional one.
- `rendererReadiness` (§9a, §25) — per-scene readiness status so the renderer knows what it can render as-is versus what requires recapture.

### RFC-0005 does NOT supply

React components, frame numbers, exact keyframes, CSS, layouts, fonts, colors, easing curves, audio files, final captions, title cards, voiceover prose, narration scripts, subtitle files, word-level timing, pixel crop coordinates, export settings.

**Renderer contract**: RFC-0006 MUST NOT reorder `mustAppear`/critical scenes, MUST NOT omit any scene with `mustAppear: true` or any `ProofChain` with `status: "verified"` feeding a critical claim, without producing an explicit renderer-side validation failure that a caller can observe (RFC-0005 does not specify that failure's shape, only that it MUST exist and MUST be distinguishable from a successful render). RFC-0006 MAY define its own Render Gate consuming `StoryGate`/`RendererReadiness`, without altering the semantic meaning of any RFC-0005 contract. This boundary is what makes the Storyboard a binding plan rather than a mere suggestion.

---

## 31. Proposed artifact set

| Artifact file | Required/Diagnostic |
|---|---|
| `story-input.json` | Required (raw `StoryCompilerInput`, or a reference to its constituent artifact IDs) |
| `normalized-story-sources.json` | Diagnostic |
| `narrative-beats.json` | Required |
| `beat-candidates.json` | Diagnostic |
| `rejected-beats.json` | Required (part of `rejectedCandidates`, may be split by type for readability) |
| `proof-chains.json` | Required |
| `scene-candidates.json` | Diagnostic |
| `rejected-scenes.json` | Required |
| `sequences.json` | Required |
| `storyboard.json` | Required (the primary `Storyboard` output, including `storyMode` and `rendererReadiness`) |
| `story-coverage.json` | Required |
| `renderer-readiness.json` | Diagnostic (`RendererReadiness` is embedded in `storyboard.json`; a standalone diagnostic copy MAY be emitted for convenience) |
| `story-metrics.json` | Diagnostic |
| `story-gate.json` | Required |
| `story-decisions.json` | Required (or reuse the existing `decisions.json` mechanism per §21) |
| `run-summary.json` | Required (matches existing RFC-0002–0004 convention) |

`storyboard.json`, `story-gate.json`, and `story-coverage.json` MAY be embedded fields within one `storyboard.json` envelope rather than separate files (matching RFC-0004's pattern of embedding `BrowserCaptureGate` inside `BrowserCaptureResult` rather than a standalone file) — final layout is an implementation decision consistent with §32's proposed `artifactId` scheme, not fixed by this RFC.

---

## 32. Proposed CLI

```
npm run compile-story -- <path-to-story-input.yaml>
```

Expected behavior (matching the `capture-browser.ts`/`analyze-demo.ts` pattern):

- Explicit input path argument (no implicit discovery).
- Schema validation, then semantic validation, before compilation begins. A missing/invalid `duration` fails validation immediately (§18, Decision 8) — no default is substituted.
- Deterministic compilation (§29) — running twice on the same input produces byte-identical `storyboard.json` modulo the excluded timestamp fields.
- Artifact persistence through the existing `FilesystemArtifactRegistry`.
- Concise console summary: run directory, `StoryGate.status`, `storyMode`, scene/sequence counts, coverage ratios, renderer-readiness summary.
- Exit code 0 for `pass`/`conditional`, non-zero for invalid input or `fail`, via the existing `determineExitCode(success, gateStatus)` helper.
- MUST NOT print sensitive DOM content or filled form values (these were already sanitized upstream by RFC-0004; the CLI additionally MUST NOT re-surface raw `BrowserDomSnapshotArtifact` content in console output).
- No browser execution, no renderer execution, no network access — this CLI is a pure compiler over already-captured artifacts.

---

## 33. JSON Schemas

Proposed schema files (mirroring the existing `*.schema.json` convention):

- `story-compiler-input.schema.json` (including `BrowserCaptureSelectionPolicy` and the closed `StoryConstraint` union)
- `narrative-beat.schema.json`
- `story-scene.schema.json`
- `story-sequence.schema.json`
- `storyboard.schema.json` (including the required `storyMode` and `rendererReadiness` fields)
- `story-gate.schema.json`
- `renderer-readiness.schema.json`

**`schemaVersion` strategy**: each schema starts at `"0.1"`, independently versioned per artifact type, following the existing project convention (`ProductUnderstanding`/`DIR` are `"0.2"`, `ExistingDemoAnalysis`/`BrowserCaptureResult` remain `"0.1"` — versions bump only when that specific artifact's own contract changes, not in lockstep). Backward compatibility: a schema version bump within RFC-0005's artifacts MUST NOT silently reinterpret an existing field's meaning — additive fields are permitted within a `"0.x"` version; a meaning-changing field requires a version bump and an explicit migration note in this RFC's changelog (to be added when the first breaking change occurs).

---

## 34. Validation invariants

Consolidated checklist (every implementation MUST verify these before emitting a `Storyboard`):

- All IDs (beats, scenes, sequences, evidence references, proof chains) are unique within the Storyboard.
- All references (beat→evidence, scene→beat, scene→scene, sequence→scene) resolve to an existing entity in the same Storyboard.
- All `confidence` values are in `[0, 1]`.
- All `durationRangeMs` are valid (`minimum ≤ target ≤ maximum`, `minimum ≥` reference minimum readable duration).
- No cyclic dependencies among scenes (`dependsOnSceneIds`) or beats (`dependencies`).
- Scene `order` is unique within its sequence; sequence `order` is unique within the Storyboard.
- All beats with `mustAppear: true` (or belonging to the selected arc's required set) are placed in exactly one scene (Decision 1).
- Every scene belongs to exactly one sequence (Decision 2); no scene id appears in more than one sequence's `sceneIds`.
- Hero Interaction causal order and authority resolution are valid (§16).
- Every `proof`-kind scene uses evidence eligible for `role: "proof"` per §8, and every `ProofChain.evidenceRefIds` entry resolves to a valid `StoryEvidenceReference`.
- Every `result`-kind scene has a resolvable upstream cause per §9.
- No CTA scene introduces a claim not already substantiated earlier in the Storyboard.
- No candidate appears in both `rejectedCandidates` and the final `beats`/`scenes` arrays.
- All `StoryCoverage` ratio fields are in `[0, 1]`.
- `StoryGate.status` is consistent with the actual presence/absence of blocking conditions (no `pass` with a non-empty category-`structural-failure`/`unsupported-claim` reason in `blockingReasons`, and vice versa — `fail` MUST have a non-empty `blockingReasons`).
- `StoryGate.status` is consistent with `RendererReadiness.status` per the rules in §25 (no `pass` while a critical scene is `"blocked"`).
- Source provenance (`sourceArtifactIds`, `StoryEvidenceReference.sourceArtifactId`/`sourceItemId`/`sourceRunId`) is preserved end-to-end, never replaced with a synthetic ID.
- No evidence reference is labeled `verified` when its originating upstream record was not itself `verified`/`passed`.
- No renderer-specific implementation detail (CSS, component names, pixel values, easing curves) appears anywhere in the Storyboard.
- No final captions, title cards, voiceover prose, narration scripts, subtitle files, word-level timing, or audio assets appear anywhere in the Storyboard (§13).
- No `critical`-importance beat/scene remains `unsupported` in the final output.
- No unverified `impact` beat satisfies critical/required coverage, with or without an `"allow-unverified-impact"` constraint (§22).
- No orphan scenes (a scene with `sequenceId` not present in `sequences`, or a scene never referenced by any sequence's `sceneIds`).
- No `required: true` sequence has an empty `sceneIds`.
- `storyMode` is present and is exactly one of `"promotional"`/`"diagnostic"`; a diagnostic-mode Storyboard never requires a CTA and is never structurally indistinguishable from a promotional one (the `storyMode` field itself makes this guarantee).
- `Storyboard.id` and all beat/scene/sequence ids are deterministic and reproducible across repeated compilation of the same input (§29).

---

## 35. Testing strategy for future implementation

The future implementation MUST include unit tests per pure function (§28 components), integration tests for the full `StoryEngine.run()` pipeline, JSON Schema conformance tests for every artifact in §33, golden-fixture regression tests (fixed input → fixed expected output, diffed field-by-field excluding timestamps), and determinism tests (run twice, assert structural equality). Required cases:

- Minimal valid story (shortest arc that reaches `pass`).
- Missing Hero Interaction (both "product genuinely has none" and "human selection exists but is unverifiable, with a technically-successful alternative present").
- Human-selected Hero Interaction that cannot be verified while a different interaction completes successfully — asserts the human selection is preserved, not silently replaced (§16).
- Proof screenshot without assertion → `partial` proof chain, not `verified`.
- Verified proof chain (passed assertion + linked artifact, `evidenceRefIds` populated).
- Failed assertion on a critical claim in promotional mode → gate impact without an automatically-selected limitation scene.
- Failed assertion relevant to objective in diagnostic mode → mandatory limitation beat selected.
- Conflicting product facts (two `Fact` records disagree) → §22 resolution.
- Conditional upstream gate (`UnderstandingGate: conditional`) → warnings propagate, compilation proceeds.
- Failed upstream gate in promotional mode (`UnderstandingGate: fail`) → compilation blocked; same input with `storyMode: diagnostic` → compilation proceeds.
- Duplicate beats (two candidates for the same claim/kind) → one rejected `duplicate`.
- Competing scene candidates → `stronger-evidence-selected` resolution.
- Stable tie-breaking (two candidates with identical scores) → deterministic winner by `sourceItemId`.
- Budget compression (target duration forces scene shrink, not removal).
- Impossible budget (even minimums exceed maximum) → `fail`, `overBudgetMs` reported.
- Missing/invalid `duration` in `StoryCompilerInput` → `invalid-input` failure, no fabricated default (§18).
- Optional CTA (objective = `explain`) → CTA absence does not block `pass`.
- Required CTA (objective = `persuade-to-buy`) → CTA absence blocks at least `conditional`.
- Diagnostic mode with `objective = persuade-to-buy` → CTA still not required.
- API product story (arc = `claim-demonstration-verification`).
- Infrastructure story (arc = `diagnosis-intervention-result`).
- Before/after story (arc = `before-interaction-after`).
- Diagnostic story concluding in `limitation` rather than `result` → valid, non-failing shape.
- Arc override via `StoryConstraint` that cannot be satisfied by available evidence → `conditional`/`fail`, no fabricated beats.
- Rejected unsupported claim (`Claim` with empty `evidenceIds`).
- Unverified `impact` beat rejected by default in promotional mode; admitted only under `"allow-unverified-impact"`, capped at `conditional`.
- Multiple `BrowserCaptureResult` runs with `authoritativeRunId` set → that run wins conflicts.
- Multiple runs, no `authoritativeRunId`, default `"latest-captured-at"` fallback → most recent `capturedAt` wins; equal timestamps broken by `runId`.
- Multiple runs where a newer run fails and an older run passed the same assertion → newer failure is authoritative, not hidden.
- `"reject-conflict"` fallback with two disagreeing runs → compilation blocked.
- `"highest-gate-status"` fallback used for non-conflicting coverage only; a genuine same-claim conflict is not silently resolved by this fallback alone.
- Renderer-ready, recapture-required, and blocked scenes, individually and combined → correct `RendererReadiness` and `StoryGate` interaction.
- Deterministic repeated compilation (byte-identical output modulo timestamps, run 2+ times).
- All RFC-0001 through RFC-0004 existing regressions remain unchanged (RFC-0005 MUST NOT modify any existing engine, contract, or test).

---

## 36. Worked examples

### Example A — Valid workflow-product demo (local TrustCheck-style fixture)

**Normalized inputs** (abridged): `productUnderstanding` names product `"TrustCheck"`, problem `"manual vendor risk review takes days"`, `selectedHeroInteraction` with `authority: "human"` pointing at candidate `hero-vendor-scan`. `dir` sets `goal: "demonstrate"`, `durationSeconds: 90`. One `browserCaptures[0]` entry (`runId: "run-001"`, `capturedAt: "2026-01-01T00:00:00Z"`) with a passed assertion `assert-scan-complete` linked to screenshot `shot-scan-result`. No `captureSelectionPolicy` supplied (defaults to `"latest-captured-at"`, moot with a single run). `constraints: []` → `storyMode: "promotional"`.

**Selected arc**: `problem-solution-proof` (a `problem` candidate at confidence 0.75 exists; `workflow-friction-compression` scored lower because only one manual-step observation was present, not multiple).

**Candidate beats (abridged)**:
```json
[
  { "id": "beat-problem-01", "kind": "problem", "confidence": 0.75, "importance": "important", "verificationStatus": "verified" },
  { "id": "beat-intro-01", "kind": "product-introduction", "confidence": 0.9, "importance": "important", "verificationStatus": "verified" },
  { "id": "beat-start-01", "kind": "interaction-start", "confidence": 0.85, "importance": "critical", "verificationStatus": "verified" },
  { "id": "beat-complete-01", "kind": "interaction-complete", "confidence": 0.9, "importance": "critical", "verificationStatus": "verified" },
  { "id": "beat-proof-01", "kind": "proof", "confidence": 0.95, "importance": "critical", "verificationStatus": "verified", "evidenceRefs": [{ "sourceType": "browser-assertion", "sourceItemId": "assert-scan-complete", "sourceRunId": "run-001", "role": "proof", "verificationStatus": "verified" }] },
  { "id": "beat-result-01", "kind": "result", "confidence": 0.8, "importance": "important", "verificationStatus": "verified" }
]
```

**Selected beats**: all six above, each placed in exactly one scene (Decision 1). **Rejected**: a candidate `hook` beat sourced from an unverified `Hypothesis` (`reasonCode: "low-confidence"`, confidence 0.4 < threshold).

**Scenes** (each in exactly one sequence, Decision 2): `scene-problem` (sequence `problem`, primary `beat-problem-01`), `scene-intro` (sequence `context`), `scene-vendor-scan-start` → `scene-vendor-scan-complete` (sequence `demonstration`, Hero Interaction), `scene-proof` (sequence `proof`, requires `assert-scan-complete`), `scene-result` (sequence `outcome`, `dependsOnSceneIds: ["scene-vendor-scan-complete", "scene-proof"]`).

**Hero Interaction**: `narrativeAuthority: "human-selected"`, `startSceneId: "scene-vendor-scan-start"`, `completionSceneId: "scene-vendor-scan-complete"`, `proofSceneIds: ["scene-proof"]`, `resultSceneId: "scene-result"`, `continuityStatus: "complete"`, `verificationStatus: "verified"`, `alternativeVerifiedInteractionIds: []`.

**Proof chain**: `{ claimId: "claim-scan-accuracy", evidenceRefIds: ["evref-scan-assert-01"], sourceAssertionIds: ["assert-scan-complete"], sourceArtifactIds: ["shot-scan-result"], proofSceneIds: ["scene-proof"], resultSceneIds: ["scene-result"], status: "verified", gaps: [] }`.

**Duration allocation**: target 90000 ms → problem/intro (setup) 18000 ms (20%, under the 25% ceiling), Hero Interaction 27000 ms (30%, above the 20% floor), proof 18000 ms (20%, above the 15% floor), result 13500 ms, CTA 4500 ms (5%, under the 10% ceiling). `overBudgetMs: 0`, `compressionApplied: false`.

**Renderer readiness**: all scenes `"ready"` (each has a linked screenshot/DOM artifact); `status: "ready"`, `blockedSceneIds: []`.

**Story Gate**: `status: "pass"` — critical claim `claim-scan-accuracy` covered by a `verified` proof chain, Hero Interaction complete and human-authority-preserved, result covered, duration fits, renderer readiness clean. `warnings: ["hero interaction rejected a low-confidence hook beat"]`.

### Example B — Screenshot without functional proof

Inputs identical to Example A except `browserCaptures[0]` contains **no assertions**, only `screenshots: [{ id: "shot-scan-result", stepId: "step-scan" }]`.

**Candidate `proof` beat**: cites `{ sourceType: "browser-screenshot", sourceItemId: "shot-scan-result", sourceRunId: "run-001", role: "proof", verificationStatus: "unverified" }`. Per §8 eligibility, a screenshot alone cannot support `role: "proof"`. This candidate is **rejected**: `{ reasonCode: "unsupported", explanation: "screenshot-only evidence cannot establish role: proof; no passed assertion available", conflictingWithIds: [], replacedByIds: [] }`.

**Resulting proof chain**: `{ claimId: "claim-scan-accuracy", evidenceRefIds: ["evref-scan-shot-01"], sourceAssertionIds: [], sourceArtifactIds: ["shot-scan-result"], proofSceneIds: [], resultSceneIds: [], status: "unsupported", gaps: ["no passed assertion available for claim-scan-accuracy"] }`.

**Effect on beats**: no `proof`-kind beat reaches `verificationStatus: "verified"`; the candidate is either dropped or re-typed as a `context`-role beat showing the scan screen without claiming it as proof. In promotional mode, this failed critical claim does **not** automatically produce a selected `limitation` scene (§22) — it simply cannot pass.

**Story Gate**: since `claim-scan-accuracy` is `importance: "critical"` and has no `verified` proof chain, `status: "fail"`, `blockingReasons: ["insufficient-evidence: missing critical proof for claim-scan-accuracy — no verified ProofChain"]`. If the claim were instead `importance: "supporting"`, the gate would be `"conditional"` with a warning about partial proof, not `"fail"`.

### Example C — Contradictory evidence and multi-run resolution

`productUnderstanding.claims` includes `claim-always-succeeds: "vendor scan always completes without manual review"`, sourced from the manifest (`sourceType: "manifest"`, `verificationStatus: "unverified"` at the claim level pending capture). Two capture runs are supplied: `run-001` (`capturedAt: "2026-01-01T00:00:00Z"`, `assert-scan-complete: { status: "passed" }`) and `run-002` (`capturedAt: "2026-01-02T00:00:00Z"`, `assert-scan-complete: { status: "failed", message: "scan timed out awaiting manual review queue" }`). No `authoritativeRunId` is set; `captureSelectionPolicy.fallback` defaults to `"latest-captured-at"`.

**Capture-run resolution** (§26): `run-002` is more recent and is authoritative for `claim-always-succeeds`. Per rule 8, the newer failure is **not** hidden by the older pass — `run-002`'s failed assertion governs. Both runs remain preserved in provenance; a `capture-run-selected` decision records the choice and the superseded `run-001` result.

**Contradiction detected**: manifest claim asserts unconditional success; the authoritative browser evidence (`run-002`) directly contradicts it. Per §22, verified capture evidence outranks the unsupported manifest declaration.

**Promotional mode** (`objective: "persuade-to-buy"`, `constraints: []` → `storyMode: "promotional"`): the `proof`/`result` beats for `claim-always-succeeds` are rejected (`reasonCode: "unsupported"`); since this is a `critical` claim per DIR, `StoryGate: fail`, `blockingReasons: ["unresolved critical contradiction: claim-always-succeeds contradicted by assert-scan-complete (failed, run-002, authoritative)"]`. No limitation scene is automatically inserted (§22) — the storyboard simply fails to reach `pass`.

**Diagnostic mode** (`constraints: [{ kind: "mode", value: "diagnostic", reason: "internal QA review" }]`): per the mandatory diagnostic-mode rule (§22), the failed assertion **must** generate a selected `limitation` beat (`beat-limitation-01: "vendor scan does not always complete without manual review — timed out in most recent observed run"`, `evidenceRefs: [{ sourceType: "browser-assertion", sourceItemId: "assert-scan-complete", sourceRunId: "run-002", role: "limitation", verificationStatus: "verified" }]`). The Storyboard has `storyMode: "diagnostic"`, has no `call-to-action` (never required in diagnostic mode, §14), and MAY reach `conditional` (the contradiction is now honestly represented, not hidden) rather than `fail`.

---

## 37. Security and privacy

- Story artifacts MUST contain **references** to evidence (artifact ID + item ID + run ID), never copies of raw sensitive values — the Storyboard points at RFC-0004's already-sanitized `BrowserDomSnapshotArtifact`/`BrowserScreenshotArtifact`, it does not re-embed DOM/pixel content.
- No cookies, tokens, headers, or form values may appear anywhere in a Storyboard, beat, scene, decision, or `RendererReadiness` entry — these were already excluded upstream by RFC-0004's sanitization; RFC-0005 MUST NOT reintroduce them via, e.g., an incautious `whyThisSceneExists` string that quotes raw captured text.
- Source labels (e.g., `sourceItemId` strings) MUST be sanitized identifiers, not raw content.
- No accidental transcript or DOM dump: `purpose`/`explanation`/`whyThisSceneExists` free-text fields MUST be generated from template strings referencing IDs and counts, not by concatenating raw upstream text blobs.
- No data amplification through narrative summaries: an `impact` beat MUST NOT restate a sensitive `Fact` in more detail than the original evidence disclosed.
- `sanitization`/redaction status from RFC-0004 artifacts (`BrowserDomSnapshotArtifact.sanitization`) MUST be preserved through any `StoryEvidenceReference` pointing at that artifact — the reference does not strip the flag.
- Uncertain or incomplete redaction on an upstream artifact MUST propagate into `RendererReadiness`: a scene referencing an artifact with unclear sanitization status MUST NOT be marked `"ready"` without an explicit override decision — it is at best `"recapture-required"`.

---

## 38. Limitations

The deterministic reference compiler deliberately does not attempt: bounded narrative arcs only (no arbitrary structure); no semantic interpretation beyond explicit contracts (it cannot infer meaning not already encoded in an upstream field); dependency on well-formed upstream IDs and claims (garbage in, `invalid-input` out — RFC-0005 does not repair malformed upstream data); no final writing-quality evaluation (a beat's `purpose` string being well-written is not checked); no visual composition intelligence, no pacing perception, no audio reasoning (these require actual rendering/perception, out of scope by design); no cultural audience adaptation beyond the explicit `StoryAudience` fields supplied; no automatic claim extraction from screenshots (screenshots are evidence *references*, never re-analyzed for new facts); no multimodal understanding.

These are deliberate: RFC-0005's value is *auditability* — every decision must be traceable to an explicit rule over explicit upstream data. Any capability that requires judgment beyond declared contracts (visual quality, pacing "feel," cultural nuance) either belongs in RFC-0006 (rendering craft) or in a future extension (§39) behind strict validation, not in the deterministic core.

---

## 39. Future extensions

None of the following are required by the RFC-0005 v0.1 reference implementation:

- Pluggable narrative strategy providers (alternative `NarrativeArcSelector` implementations).
- LLM-assisted candidate generation — strictly behind the same §7–§9 validation invariants; an LLM MAY *propose* candidate beats/scenes, but every proposal passes through the identical eligibility/invariant checks as deterministically-generated candidates, with no bypass.
- Genre-specific arc packs beyond §15's initial eight.
- Audience-specific story policies (per-segment weighting overrides).
- Judge-oriented variants (storyboards tuned for a specific evaluation rubric).
- Multi-duration storyboard variants (e.g., 30s/90s/3min from one compilation).
- Adaptive CTA selection (choosing among multiple valid CTA framings).
- Creative divergence/tournament engine (generating and ranking multiple candidate storyboards).
- Visual rhythm model (pacing perception feedback).
- Voice and caption compiler (turning `voiceIntent`/`textIntent` into actual prose — see §13's boundary and §40.13).
- Non-browser evidence source eligibility policies (documents, receipts, logs, metrics feeding `ProofChain.evidenceRefIds` per §17's extensibility design).
- Explicit duration-default policy packs (§18, §40.8).
- Renderer feedback loop (RFC-0006 reporting back what actually rendered, closing the loop).
- A dedicated RFC-0006 Render Gate consuming `StoryGate`/`RendererReadiness` (§9a, §30, §40.9).
- Critic engine (automated quality critique beyond `StoryMetrics`).
- Story A/B variants.
- Learning from successful demos (no ML training loop in scope).

---

## 40. Resolved v0.1 architecture decisions

All fifteen items below were open questions in the draft and are now owner-approved. None remains unresolved; the normative rules are applied throughout this document, not only here.

1. **Beat ownership.** Tradeoff: reuse across scenes vs. unambiguous duration/coverage accounting. Decision: a `NarrativeBeat` belongs to exactly one selected scene; a scene MAY carry multiple beats. Normative consequence: §7, §9 enforce exclusive beat ownership; repeated narrative ideas require distinct beats with distinct provenance (§6). Status: **Accepted for v0.1**.

2. **Scene ownership.** Tradeoff: cross-sequence scene reuse vs. clean sequence-level duration budgeting. Decision: a `StoryScene` belongs to exactly one `StorySequence`; cross-sequence relationships flow only through `dependsOnSceneIds`/`supportsSceneIds` and `ProofChain` references. Normative consequence: §9, §12, §34 enforce exclusive scene ownership. Status: **Accepted for v0.1**.

3. **Failed assertions and limitation beats.** Tradeoff: mandatory-everywhere guarantees honesty but clutters promotional demos with minor-failure noise. Decision: promotional mode records gate impact and provenance but does not force a selected limitation scene except when it improves an honest narrative; diagnostic mode mandates a limitation beat for objective-relevant failures. Normative consequence: §22 (full policy), §25 (gate examples), §26 (upstream gate table), §36 Example C. Status: **Accepted for v0.1**.

4. **CTA requirement.** Tradeoff: universal requirement over-constrains explanatory/diagnostic content; universal optionality weakens persuasive demos. Decision: required only for `persuade-to-try`/`persuade-to-review`/`persuade-to-buy`; optional otherwise; never required in diagnostic mode. Normative consequence: §6, §14, §25. Status: **Accepted for v0.1**.

5. **Multiple `BrowserCaptureResult` runs.** Tradeoff: single-run-only is fragile against flaky captures; multi-run needs an unambiguous precedence rule. Decision: accept an array, resolved via the explicit `BrowserCaptureSelectionPolicy` contract (`authoritativeRunId` → `fallback`, default `"latest-captured-at"`); array order carries no authority. Normative consequence: §17, §22, §26 (full policy), §27, §29, §36 Example C. Status: **Accepted for v0.1**.

6. **Hero Interaction authority.** Tradeoff: fully automatic resolution is convenient but can silently override human intent; fully manual resolution is safer but less automatable. Decision: human-authority selection governs narrative importance; browser evidence governs demonstrability only; a verified alternative never silently replaces a human selection. Normative consequence: §16 (full authority model), §19, §22, §25, §26. Status: **Accepted for v0.1**.

7. **Story mode.** Tradeoff: two duplicated contracts give stronger typing but double the maintenance surface; one contract with a discriminant is simpler. Decision: single `Storyboard` contract with a required `storyMode: "promotional" | "diagnostic"` field, resolved once during normalization. Normative consequence: §5, §9a, §13, §14, §22, §25, §26 (resolution rule), §30. Status: **Accepted for v0.1**.

8. **Missing duration.** Tradeoff: a default unblocks compilation conveniently but violates the never-invent principle. Decision: `duration` remains required; no silent default; missing/invalid duration is an `invalid-input` failure. Normative consequence: §18, §25, §27, §32, §35. Status: **Accepted for v0.1**; explicit caller-opted-in default policy packs remain **Deferred to future RFC** (§39).

9. **Renderer readiness.** Tradeoff: a second gate cleanly separates "good story" from "can render now" but fragments the pass/conditional/fail surface. Decision: one `StoryGate` for v0.1; `RendererReadiness` is a structured contributing dimension, not an independent gate. Normative consequence: §9a, §13, §25, §28, §30, §31, §33, §34, §36, §37. Status: **Accepted for v0.1** for the RFC-0005 boundary; a dedicated RFC-0006 Render Gate consuming these contracts is **Deferred to future RFC**.

10. **ProofChain normalization.** Tradeoff: direct browser-specific fields are precise but couple the contract tightly to RFC-0004; a fully normalized-only contract is uniform but loses browser-specific auditability. Decision: `evidenceRefIds` is the canonical, source-agnostic proof input; `sourceAssertionIds`/`sourceArtifactIds` are retained alongside it for browser-specific auditability. Normative consequence: §8, §17 (full policy), §23, §25, §30, §34, worked examples. Status: **Accepted for v0.1**.

11. **Unsupported impact claims.** Tradeoff: omission is safest but loses valuable framing; unconditional inclusion risks dishonest promotion. Decision: in promotional mode, unverified `impact` beats are excluded by default and admitted only under an explicit `"allow-unverified-impact"` constraint, capped at `conditional` and never counted toward critical coverage; in diagnostic mode they may appear as labeled hypotheses without the constraint. Normative consequence: §6, §7, §14, §19, §22 (full policy), §23, §25, §27, worked examples. Status: **Accepted for v0.1**.

12. **Narrative Arc selection.** Tradeoff: caller-fixed arcs are steerable but risk forcing an unsupported structure; deterministic selection is safer but less controllable. Decision: deterministic selection by default via the closed reference set and stable tie-breaking, with an explicit `arc-override` `StoryConstraint` that still must satisfy every invariant. Normative consequence: §15 (full policy). Status: **Accepted for v0.1**.

13. **Text/voice boundary.** Tradeoff: RFC-0005 needs enough intent for RFC-0006 to act on, but full prose generation is a distinct, potentially generative concern. Decision: RFC-0005 owns only closed-enum semantic intent (`textIntent`, `voiceIntent`, `audienceTakeaway`, `purpose`, `whyThisSceneExists`); it never contains final captions, title cards, voiceover prose, narration scripts, subtitle files, word-level timing, or audio assets. Normative consequence: §4, §10, §13 (full boundary), §30, §34. Status: **Accepted for v0.1** for the boundary itself; the future voice/caption compiler RFC that consumes this intent is **Deferred to future RFC**.

14. **One storyboard vs. ranked alternatives.** Tradeoff: alternatives give choice but double validation/gating surface and reintroduce ambiguity about which plan is authoritative. Decision: the reference compiler emits exactly one canonical `Storyboard` per compilation. Normative consequence: §4, §5, §13, §28, §35. Status: **Accepted for v0.1**; tournaments/A-B variants/multi-duration variants remain **Deferred to future RFC** (§39).

15. **Blocking conditions and numeric narrative policies.** Tradeoff: an overly strict `fail` list blocks legitimate demos over minor gaps; an overly permissive list lets weak demos through as `pass`. Decision: `fail` is reserved for missing/broken required proof, structural impossibility, and duration infeasibility with no valid compression; proportional numeric policies (setup ≤25%, Hero Interaction ≥20%, proof ≥15%, CTA ≤10%, readable-scene ≥1500ms) generate warnings/conditional status only and are never independently blocking. Normative consequence: §18, §25 (full policy). Status: **Accepted for v0.1** for the policy structure; exact numeric threshold calibration against real fixtures is **Deferred to future RFC** (or a pre-implementation fixture-calibration pass that does not require re-opening this RFC's architecture).

---

*End of RFC-0005 v0.1 specification, accepted for implementation.*
