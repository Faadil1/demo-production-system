# RFC-0005 — Story Engine & Storyboard Compiler

Status: Draft specification
Implementation: Not started

---

## 1. Executive summary

RFC-0001 through RFC-0004 establish a chain of **evidence-producing** artifacts: `ProductUnderstanding` (RFC-0002) states what is true and how confidently; `DemoIntermediateRepresentation`/DIR (RFC-0002) states what the demo must accomplish; `ExistingDemoAnalysis` (RFC-0003) evaluates prior demo attempts against that evidence; `BrowserCaptureResult` (RFC-0004) proves specific product behavior actually happened, with assertions, screenshots, sanitized DOM snapshots, and network records.

None of these artifacts is a story. A `ProductUnderstanding` with 40 verified facts is not narratable by itself — it has no order, no audience framing, no sense of which fact matters *first*, and no notion of a beginning, middle, and end. Evidence answers "what is true." A story answers "what does the audience need to understand, and in what order, to reach a specific conclusion." Collapsing these two concerns — as ad hoc demo scripts and one-shot LLM narration tools do — produces demos that are either chronological screen-recording dumps (faithful to capture order, useless as narrative) or confident-sounding fabrications (narratively coherent, factually unmoored).

RFC-0005 inserts a **Story Engine** between evidence (RFC-0002–0004) and rendering (RFC-0006, not yet specified). The Story Engine's only raw materials are facts, claims, hypotheses, evidence items, observations, findings, and decisions that already exist in upstream artifacts. It is not permitted to invent new product facts. Its allowed operations are: **select, reject, prioritize, group, order, compress, connect, justify**. The output is a `Storyboard` — a complete, renderer-independent demo plan expressed as ordered scenes with explicit evidence backing, semantic presentation intent, duration targets, and a pass/conditional/fail gate.

Rendering is deliberately excluded. A `Storyboard` says a scene must *demonstrate* a *focused-element* view with *metric* text intent and a *reveal* transition; it does not say which React component, which easing curve, or which pixel crop achieves that. This separation lets the Story Engine be **fully deterministic and testable without producing a single frame of video** — an important property for a system whose core promise is that demos do not lie about what the product does.

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
6. **Missing Hero Interaction.** The single interaction RFC-0002/0003 identified as the product's core value moment gets diluted across many equally-weighted scenes, or omitted entirely under duration pressure.
7. **Proof appearing before its context.** A result is shown before the audience has seen the action that produced it, breaking causal legibility.
8. **Result without visible cause.** An outcome (e.g., "3 minutes saved") appears with no interaction shown that plausibly caused it.
9. **CTA disconnected from demonstrated value.** The call-to-action asserts value the demo never proved.
10. **Renderer inventing narrative structure.** Without a renderer-independent plan, RFC-0006 (or any renderer) ends up making narrative decisions — which scene matters more, what order things go in — that belong upstream and should be auditable independent of rendering technology.
11. **Excessive scene count.** No mechanism bounds scene count relative to duration budget, producing frantic, unwatchable demos.
12. **Overlong setup.** Context-setting consumes a disproportionate share of runtime, starving proof and result.
13. **Contradictory claims.** Two upstream sources disagree (e.g., manifest says "always succeeds," a browser assertion failed) and nothing surfaces or resolves the conflict before it reaches a viewer.
14. **Low-confidence evidence treated as definitive.** A hypothesis or partially-verified fact gets narrated with the same certainty as a verified fact.
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
- Hero Interaction protection: the RFC-0002/0003 Hero Interaction cannot be silently dropped, reordered incorrectly, or diluted without gate impact.
- Proof and result visibility: causal order (cause → interaction → proof → result) is a structural invariant, not a style preference.
- Duration-budget planning: scenes fit a target runtime through deterministic compression/removal rules, not ad hoc truncation.
- Narrative completeness evaluation via `StoryCoverage` and `StoryMetrics`.
- Preservation of uncertainty: confidence and verification status propagate from evidence through beats, scenes, and the gate — never silently upgraded.
- Stable serialization: consistent ID generation, ordering, and JSON shape across runs.
- Compatibility with future renderers: `Storyboard` output must be consumable by any renderer that respects the presentation-intent contract, not just a Remotion-based RFC-0006.
- Testability without video production: every stage of the pipeline is a pure function over JSON-serializable input/output.

---

## 4. Non-goals

RFC-0005 explicitly does **not** include:

- Screenplay prose generation or final voiceover writing (voice *intent*, not voice *text*, belongs here — see §10).
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

RFC-0005 MAY define extension points (e.g., pluggable `NarrativeArc` packs, pluggable beat-candidate generators) but MUST NOT require them for the v0.1 reference implementation.

---

## 5. Terminology and hierarchy

| Term | Definition |
|---|---|
| **Story Source** | One upstream artifact instance supplied to the compiler: a `ProductUnderstanding`, a `DemoIntermediateRepresentation`, an `ExistingDemoAnalysis`, or a `BrowserCaptureResult`. Each Story Source is uniquely identified by its `artifactId`/`runId` pair from the RFC-0001 `ArtifactEnvelope`. |
| **Story Fact** | A normalized reference to an upstream `Fact`, `Claim`, `Hypothesis`, `EvidenceItem`, `DemoObservation`, `ExistingDemoEvidenceItem`, `BrowserAssertionResult`, or similar atomic upstream record, wrapped with its original verification status and source artifact ID. The Story Engine never creates new Story Facts from nothing — every one resolves to an upstream record. |
| **Story Claim** | A normalized reference to an upstream `Claim` or DIR `EvidenceReference["claim"]` string — a statement the demo is meant to substantiate. |
| **Story Evidence Reference** | The typed pointer contract defined in §8, linking a beat or scene to the Story Fact(s)/Story Claim(s) that justify it. |
| **Narrative Beat** | The smallest unit of narrative intent: "the audience must understand X." A beat has a `kind` (§6), a required takeaway, and evidence references. Beats are pre-visual — they say nothing about how they will be shown. |
| **Scene** | The evidence-backed, renderer-independent unit that carries one or more beats into a specific presentation intent, duration target, and evidence set. Scenes are what RFC-0006 consumes. |
| **Sequence** | An ordered group of Scenes serving one coherent narrative purpose (e.g., "problem," "demonstration," "proof"). Sequences give the Storyboard its top-level shape. |
| **Storyboard** | The complete, renderer-independent demo plan: all beats, scenes, sequences, the Hero Interaction Sequence, proof chains, duration budget, coverage, metrics, decisions, and gate. |
| **Narrative Arc** | A named, closed-set structural template (§15) that determines which beat kinds are required/optional/forbidden and their relative ordering. |
| **Story Transition Intent** | A semantic (not visual) statement of how one scene relates to its neighbor — e.g., `cause-to-effect`. Renderer-neutral; see §11. |
| **Story Constraint** | A caller-supplied restriction on compilation (e.g., "no scene may exceed 8000 ms," "CTA is required"). Distinct from invariants, which are unconditional. |
| **Story Decision** | A `DecisionRecord`-compatible entry (§21) documenting one compiler choice: input, rule applied, alternatives, outcome, confidence, reversibility. |
| **Rejected Candidate** | A beat or scene that was generated as a candidate but not selected, with a reason code (§20). |
| **Story Coverage** | The quantitative record (§23) of how much of the required narrative surface (claims, beats, proof) the Storyboard actually satisfies. |
| **Story Gate** | The pass/conditional/fail verdict (§25) on whether the Storyboard is fit to proceed to rendering. |
| **Duration Budget** | The deterministic allocation (§18) of target runtime across sequences and scenes. |
| **Hero Interaction Sequence** | The protected contract (§16) carrying the single most important product interaction through start → progress → completion → proof → result. |
| **Proof Chain** | The traceable path (§17) from a claim through the scenes and evidence that substantiate it. |
| **Audience Takeaway** | The one-sentence statement, required on every beat, of what the audience should believe or know after that beat plays. |
| **Renderer Hint** | Any field prefixed "presentation," "transition," or "intent" in a scene. **Renderer Hints are non-binding semantic intent, not implementation instructions.** RFC-0006 MAY choose how to realize `visualRole: "prove"`, but MUST NOT reinterpret *whether* a scene proves something — that is fixed by evidence, not by rendering choice. |

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
| `proof` | Substantiate a claim with verifiable evidence | Passed `BrowserAssertionResult` + linked artifact | Screenshot alone; failed assertion | Treating a screenshot as functional proof | conditional (required for critical claims) | after cause | yes (one per proof chain) | ≥ 0.8 for `verified` |
| `comparison` | Contrast before/after or product/alternative | Paired `Fact`/`EvidenceItem` on both sides | One-sided evidence dressed as comparison | Comparing to an uncited competitor claim | optional | mid-late | yes | ≥ 0.6 |
| `result` | Show the outcome of the interaction | `DemoObservation` after interaction, `ExistingDemoEvidenceItem(kind: result-visible)` | Outcome with no preceding cause | Result before interaction (causal-order invariant violation) | required if Hero Interaction present | after `interaction-complete`/`proof` | no | ≥ 0.6 |
| `impact` | Generalize the result to business/user value | `Fact`/`Claim` tied to `result`, else `hypothesis` explicitly labeled | Unlinked ROI figures | Silent hypothesis-to-fact promotion | optional | late | no | flagged unverified if source is hypothesis |
| `trust` | Signal credibility (security, compliance, scale) | `Fact`/`EvidenceItem` | Logos/testimonials with no evidence record | Trust theater with no backing | optional | late | no | ≥ 0.6 |
| `limitation` | Disclose a known gap, failure, or constraint | Failed `BrowserAssertionResult`, `ExistingDemoRisk`, `Risk` | Omission (silence is not a limitation beat) | Burying limitations mid-demo instead of framing them | conditional (required when a required claim has failed evidence, see §22) | any | yes | n/a — limitation beats do not carry a "confidence of success" |
| `next-step` | Tell the audience what to do next, non-commercially (docs, trial setup) | DIR `goal`, `StoryObjective` | none | Confusing with `call-to-action` | optional | last | no | n/a |
| `call-to-action` | Explicit ask (buy, book, sign up) | `StoryObjective` in `persuade-*` set | none | Asking for action beyond what was demonstrated | conditional (see §14 rule) | last | no | n/a |

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
- **Diagnostic demo**: `current-state → interaction → limitation (or proof) → result` — MAY terminate in `limitation` without a `call-to-action` (see §26 on diagnostic mode)
- **Comparison demo**: `problem → comparison → interaction (on the selected side) → proof → result`

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
- A beat whose `kind` is `impact` and whose only source is a `Hypothesis` MUST remain `verificationStatus: "unverified"` even if `importance` is `"critical"` — unsupported business impact MUST NOT be silently upgraded to strengthen a demo's persuasiveness.
- `purpose` MUST NOT be empty.

**Invalid-case example:** a candidate `impact` beat states "saves teams 10 hours/week" with `sourceFactIds: []`, `sourceClaimIds: ["claim-042"]` where `claim-042.evidenceIds` is empty. This beat is rejected at candidate generation (§19, reason `unsupported`) — a `Claim` with no backing evidence cannot justify a beat regardless of how compelling the statement is.

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
  readonly verificationStatus:
    | "verified" | "partially-verified" | "unverified";
  readonly role:
    | "context" | "cause" | "interaction" | "proof" | "result" | "limitation";
};
```

### Evidence eligibility rules

- A `browser-screenshot` reference MAY support `role: "context"` or `role: "interaction"`. It MUST NOT alone support `role: "proof"` — a screenshot shows a screen state, not a verified condition.
- A `browser-assertion` reference with `status: "passed"` (per RFC-0004 `BrowserAssertionResult`) linked to at least one artifact (screenshot or DOM snapshot) MAY support `role: "proof"`.
- A `browser-assertion` with `status: "failed"` MUST NOT support `role: "proof"` or `role: "result"`. It MAY support `role: "limitation"`.
- A transcript-only reference (spoken claim with no visual/state corroboration, per `ExistingDemoEvidenceItem(kind: "claim-spoken")`) MUST NOT alone support `role: "proof"`. Transcript text cannot become visual proof.
- A `Hypothesis`-sourced reference MAY support `role: "context"` only, and MUST carry `verificationStatus: "unverified"`; it MUST NOT support `role: "proof"`, `role: "cause"`, or `role: "result"`.
- An `analysis-finding` sourced from `ExistingDemoAnalysis` recommendations text is **not** product evidence — it describes a prior demo's quality, not the product's behavior. It MAY support only `role: "context"` beats about narrative strategy (e.g. informing beat selection), and MUST NOT be cited as evidence for a `proof` or `result` beat.
- A `capture-observation` reference MUST retain its originating `sourceArtifactId`/`sourceItemId` (the RFC-0004 observation and, transitively, the `BrowserStepResult`/`BrowserAssertionResult` it derived from) — the Story Engine MUST NOT flatten provenance to just "a browser ran."

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
  readonly requiredEvidenceRefs: readonly string[];   // StoryEvidenceReference ids
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

- Every scene MUST have exactly one `primaryBeatId`, and it MUST be a member of `beatIds`.
- Every id in `beatIds`, `dependsOnSceneIds`, `supportsSceneIds`, and `mustNotAppearWith` MUST resolve to an existing beat/scene in the same `Storyboard`. Unresolved references invalidate the scene.
- `order` MUST be unique within `sequenceId` and MUST be a non-negative integer with no gaps required (gaps are permitted; duplicates are not).
- A scene with `mustAppear: true` MUST NOT be removed by duration compression (§18). Compression MAY shrink its `durationTargetMs` down to `durationRangeMs.minimum`, but removal requires either (a) an explicit `StoryConstraint` override recorded as a `StoryDecision`, or (b) the scene becomes structurally invalid (e.g., its evidence was withdrawn) — in which case the Story Gate MUST reflect the loss (§25).
- A scene whose beats include a `proof`-kind primary beat MUST have `requiredEvidenceRefs` containing at least one reference eligible for `role: "proof"` per §8.
- A scene whose beats include a `result`-kind primary beat MUST have at least one entry in `dependsOnSceneIds` pointing to a scene containing an `interaction-complete` or `proof` beat — a result scene requires an upstream cause.
- A scene whose beats include a `call-to-action`-kind primary beat MUST NOT introduce a `sourceClaimIds`/`sourceFactIds` reference that does not already appear in an earlier scene's beats — a CTA cannot claim unproven value.
- `durationRangeMs.minimum` MUST be ≤ `durationTargetMs` ≤ `durationRangeMs.maximum`, and `minimum` MUST be ≥ the reference minimum readable scene duration (§18).
- `dependsOnSceneIds` across the full scene set MUST be acyclic.
- Two scenes that are each other's `mustNotAppearWith` MUST NOT both appear in the final `Storyboard.scenes`; if candidate generation produces both, one MUST be resolved via §20 scoring before compilation completes.
- **Renderer intent cannot override evidence requirements**: `presentationIntent` MUST NOT be used to satisfy `requiredEvidenceRefs` — e.g., a scene cannot claim `role: "proof"` satisfied merely by choosing `visualRole: "prove"`; the underlying reference must independently meet §8 eligibility.

**Invalid-case example:** a `result` scene ("users close the deal 30% faster") has `dependsOnSceneIds: []`. This is invalid per the causal-necessity invariant above — it is rejected at scene construction (§19 step 9) and demoted to a candidate with reason `dependency-missing`, unless a valid `interaction-complete`/`proof` scene is subsequently linked.

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

Out of scope for `ScenePresentationIntent` (and for RFC-0005 generally): CSS, pixel coordinates, Remotion APIs or component names, font families, color values, animation easing curves, frame numbers, or audio file references. Any of these appearing in a `Storyboard` is a spec violation.

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
- **Merging rules**: `context` and `problem` sequences MAY be merged into one when combined scene count ≤ 2 and the arc does not require them distinct; merging MUST be recorded as a `StoryDecision` (`sequence-merged`).
- **Prohibited orderings**: a `proof` sequence MUST NOT precede its corresponding `demonstration` sequence; an `outcome` sequence MUST NOT appear with zero preceding `demonstration` or `proof` sequences.
- **Hero Interaction span**: the Hero Interaction Sequence (§16) typically spans `demonstration` and `proof` sequence kinds — its `startSceneId` lives in `demonstration`, its `proofSceneIds` in `proof`, and its `resultSceneId` (if present) in `outcome`. It MUST NOT span into `opening`/`context`.
- **Proof chain crossing**: a `ProofChain` (§17) MAY span scenes in different sequences (e.g., `contextSceneIds` in `context`, `proofSceneIds` in `proof`) — sequences group narrative purpose, not evidence chains, so proof chains are permitted to cross sequence boundaries as long as scene-level `dependsOnSceneIds` ordering is respected.

---

## 13. Storyboard contract

```ts
// DRAFT CONTRACT
type Storyboard = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly sourceArtifactIds: readonly string[];
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
  readonly rejectedCandidates: readonly RejectedStoryCandidate[];
  readonly decisions: readonly StoryDecision[];
  readonly gate: StoryGate;
  readonly metrics: StoryMetrics;
};
```

**ID stability**: `Storyboard.id` MUST be a deterministic function of `sourceArtifactIds` plus compiler `schemaVersion` (e.g., a content hash per the RFC-0001 `contentHashOf()` convention), not a random UUID — two compilations of the same inputs against the same compiler version MUST produce the same `Storyboard.id`. Beat, scene, and sequence ids MUST be stable slugs derived from their position in the deterministic candidate-generation order (e.g., `beat-proof-01`, `scene-demonstration-03`), not random.

**Serialization ordering**: `beats`, `scenes`, and `sequences` arrays MUST be serialized in their final compiled order (matching `StoryScene.order`/`StorySequence.order`), not candidate-generation order. `rejectedCandidates` and `decisions` MUST be serialized in deterministic generation order (§29).

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
- Persuasive objectives (`persuade-to-try`, `persuade-to-review`, `persuade-to-buy`) do not relax evidence rules — every invariant in §7–§9 applies identically regardless of `objective`.
- `objective` influences **ordering and inclusion** (e.g., persuasive objectives make `call-to-action` beats conditionally required, per the rule in §6), not **truth status** of any beat or scene.
- Rule for CTA requirement: a `call-to-action` beat is REQUIRED when `objective` is in `{persuade-to-try, persuade-to-review, persuade-to-buy}` and OPTIONAL otherwise (see open question §40.4 for the alternative policy).

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
| `capability-example-impact` | product-introduction → mechanism → interaction-start → interaction-complete → result → impact | trust, call-to-action | consumer, general | `impact` beat has verified or clearly-labeled-hypothesis backing | `impact` unsupported entirely | impact beat becomes unsupported speculation |

**Selection procedure**: candidate beats are generated first (§19 step 6); the arc selector (§28 `NarrativeArcSelector`) scores each arc by how many of its required beat kinds have at least one eligible candidate at `importance ≥ "important"`, picks the highest-scoring arc, and breaks ties by list order above (i.e., `problem-solution-proof` wins ties as the default/most general arc). If no arc reaches full required-beat coverage, the highest-scoring arc is still selected but the gap is recorded in `StoryCoverage` and MAY produce a `conditional` or `fail` Story Gate depending on which required beats are missing (§25).

---

## 16. Hero Interaction Sequence

```ts
// DRAFT CONTRACT
type HeroInteractionSequence = {
  readonly id: string;
  readonly sourceHeroInteractionId: string;   // ProductUnderstanding.selectedHeroInteraction.candidateId, or RFC-0003 heroInteraction id
  readonly startSceneId: string;
  readonly progressSceneIds: readonly string[];
  readonly completionSceneId: string;
  readonly proofSceneIds: readonly string[];
  readonly resultSceneId: string | null;
  readonly continuityStatus: "complete" | "partial" | "broken";
  readonly confidence: number;
};
```

### Rules

- Scene ordering within the sequence MUST satisfy `order(startSceneId) < order(progressSceneIds[i]) < order(completionSceneId) < order(proofSceneIds[i]) < order(resultSceneId)` wherever each field is present — causal order is a hard invariant, not a preference.
- `completionSceneId` MUST NOT be ordered before `startSceneId`.
- Every scene in `proofSceneIds` MUST reference a state that follows `completionSceneId`; a proof scene cannot precede the state it proves.
- If `resultSceneId` is non-null, it MUST depend (via `StoryScene.dependsOnSceneIds`, transitively) on `completionSceneId` or a scene in `proofSceneIds`.
- Scenes not part of the Hero Interaction Sequence MUST NOT be interleaved between `startSceneId` and `completionSceneId` in final sequence order unless `whyThisSceneExists` on the interleaved scene explicitly justifies the interruption (e.g., a necessary side-panel context scene) AND that justification is recorded as a `StoryDecision`.
- `continuityStatus: "broken"` (start and completion exist but the path between them is discontinuous, e.g., a required `progressSceneIds` scene was rejected for evidence reasons) or a missing `completionSceneId` entirely MUST set the Story Gate to at least `conditional`, and to `fail` if `StoryObjective` is `prove` or `demonstrate` (see §25).
- **A product MAY have no valid Hero Interaction.** When `ProductUnderstanding.selectedHeroInteraction` is `null` and `ExistingDemoAnalysis.heroInteraction.status` (if supplied) is not `"identified"`, `Storyboard.heroInteraction` MUST be `null`. The compiler MUST NOT fabricate a Hero Interaction from an arbitrary scene to fill the field — see §22 for the resolution procedure when RFC-0002 and RFC-0003 disagree on which interaction is the hero.

---

## 17. Proof Chain

```ts
// DRAFT CONTRACT
type ProofChain = {
  readonly id: string;
  readonly claimId: string;
  readonly contextSceneIds: readonly string[];
  readonly actionSceneIds: readonly string[];
  readonly assertionIds: readonly string[];      // BrowserAssertionResult ids
  readonly evidenceArtifactIds: readonly string[]; // BrowserScreenshotArtifact/BrowserDomSnapshotArtifact ids
  readonly proofSceneIds: readonly string[];
  readonly resultSceneIds: readonly string[];
  readonly status: "verified" | "partial" | "unsupported";
  readonly gaps: readonly string[];
};
```

- `status: "verified"` REQUIRES: at least one `assertionIds` entry with `status: "passed"`, at least one `evidenceArtifactIds` entry linked to that assertion, and at least one `proofSceneIds` entry.
- `status: "partial"` covers: screenshot-only support (no passed assertion), or a passed assertion with no linked artifact, or missing `resultSceneIds` while proof itself is sound. A **screenshot-only chain is `"partial"` at best** — it can never reach `"verified"`.
- `status: "unsupported"` covers: no eligible evidence at all, or the only assertion available has `status: "failed"`. A **failed assertion cannot produce `"verified"` status** under any combination with other evidence.
- A `Claim` MAY have multiple `ProofChain`s (e.g., one per browser capture run); the Storyboard MUST retain all of them, not collapse to the strongest — see §22 on multiple capture runs.
- Critical claims (referenced by a beat with `importance: "critical"`) REQUIRE at least one `ProofChain` with `status: "verified"` for the Storyboard to reach `pass` (§25).
- Duplicate evidence (the same `assertionIds`/`evidenceArtifactIds` cited in two different `ProofChain`s for the same claim) MUST NOT increase confidence automatically — `ProofChain.status` is evaluated per-chain from its own evidence set, and redundant chains do not stack.

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
- **Default ranges**: the compiler MUST NOT invent a target duration when none is supplied unless an explicit `StoryConstraint` permits a documented reference default. §40.8 marks this as an open question; until resolved, an absent `duration.targetMs` with no constraint override MUST cause `Story Gate` status `fail` with reason `invalid input`.
- **Minimum readable scene duration**: a reference constant (proposed: 1500 ms) below which a scene cannot be compressed regardless of priority — text/state cannot register below this floor.
- **Maximum setup proportion**: `opening` + `context` + `problem` sequence durations combined SHOULD NOT exceed 25% of `targetMs` (reference constraint, evaluated not hard-coded — see §20).
- **Hero Interaction minimum share**: the Hero Interaction Sequence's scenes SHOULD receive no less than 20% of `targetMs` when a Hero Interaction is present.
- **Proof minimum share**: `proof` sequence scenes SHOULD receive no less than 15% of `targetMs` when any critical claim requires proof.
- **CTA maximum share**: `call-to-action` scenes SHOULD NOT exceed 10% of `targetMs`.
- **Removal priority** (lowest priority removed first under compression): `supporting` priority, non-`mustAppear` scenes with the lowest `confidence` first; then `important` priority under the same rule; `critical` and `mustAppear` scenes are removal-protected (see §9).
- **Compression priority**: before removing any scene, the compiler MUST attempt to shrink `durationTargetMs` toward `durationRangeMs.minimum` for `supporting` and `important` scenes, in ascending priority order.
- **What happens when the story cannot fit**: if, after full compression and all eligible removals, `allocatedMs` (summed `mustAppear`/`critical` scene minimums) still exceeds `maximumMs`, the compiler MUST NOT silently truncate — it MUST set `overBudgetMs = allocatedMs - maximumMs`, leave `compressionApplied: true`, and the Story Gate MUST report `fail` with reason `storyboard over budget with no valid compression` (§25). Silent deletion of a `mustAppear` scene to force a fit is prohibited.

---

## 19. Candidate generation

The reference pipeline is a deterministic, ordered sequence of pure stages. No stage may use randomness, wall-clock time (other than for non-semantic metadata), or external I/O.

1. **Normalize story inputs** — resolve `StoryCompilerInput` sources into a canonical internal representation with stable, sorted IDs (§29).
2. **Validate provenance** — confirm every referenced upstream artifact ID/run ID actually resolves within the supplied inputs; reject inputs with dangling references.
3. **Identify required claims** — union of DIR `EvidenceReference["claim"]` entries and `ProductUnderstanding.claims` flagged `importance: critical` (or equivalent).
4. **Identify verified evidence** — filter all Story Evidence References down to those meeting §8 eligibility per intended role.
5. **Identify Hero Interaction** — resolve per §22 precedence rules between RFC-0002's `selectedHeroInteraction` and RFC-0003's `heroInteraction`.
6. **Generate candidate beats** — deterministically enumerate one candidate beat per eligible (kind, source-record) pairing per §6's valid-source-evidence column.
7. **Reject unsupported beats** — apply §7 invariants; move failures to `rejectedCandidates`.
8. **Select narrative arc** — per §15 selection procedure.
9. **Build candidate scenes** — group surviving beats into scenes per the arc's structure, respecting §9 invariants (one primary beat, evidence-backed proof/result linkage).
10. **Construct proof chains** — per §17, from scenes carrying `proof`/`result` beats.
11. **Order dependencies** — topologically sort scenes/sequences by `dependsOnSceneIds` and arc-required kind ordering; reject on cycle detection.
12. **Apply duration budget** — per §18.
13. **Calculate coverage** — per §23.
14. **Compute Story Gate** — per §25.
15. **Emit decisions and rejected candidates** — per §21/§20.

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
  | "forbidden-in-current-arc";
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

`audience-selected`, `objective-selected`, `narrative-arc-selected`, `beat-selected`, `beat-rejected`, `scene-selected`, `scene-rejected`, `sequence-merged`, `sequence-removed`, `proof-chain-accepted`, `proof-chain-rejected`, `duration-compressed`, `story-gate-computed`.

Each entry MUST include input references (source artifact/item IDs), the rule applied (a cross-reference to the relevant RFC-0005 section, e.g. `"§9 causal-necessity invariant"`), alternatives considered, the selected outcome, confidence, reversibility, and deterministic ordering (§29) in place of wall-clock sequencing for comparison purposes.

**Aggregation rule**: individual `beat-rejected`/`scene-rejected` decisions for the same `reasonCode` against the same replacement MAY be aggregated into one `StoryDecision` with multiple `candidateSnapshot` references in `RejectedStoryCandidate`, rather than one verbose decision per rejected item, when the rule applied is identical across all of them.

---

## 22. Contradiction handling

| Scenario | Principle applied | Outcome |
|---|---|---|
| Two facts conflict (e.g., two `Fact` records disagree) | Verified direct evidence outranks unsupported narrative declarations | The `Fact` with stronger `verificationStatus` is used; the weaker is recorded in `uncertaintyNotes` on any beat that would have used it, not silently dropped |
| Claim confidence differs across sources | Preserve provenance for both | Beat cites the source with the highest `verificationStatus`; a `limitation`-adjacent note records the divergence if the gap is large (implementation-defined threshold) |
| Capture contradicts manifest (e.g., DIR/manifest asserts a behavior, `BrowserCaptureResult` assertion fails) | Verified capture evidence outranks manifest assertion | The failed assertion wins; any beat claiming the manifest's version MUST be rejected (`reasonCode: unsupported`) or re-typed as `limitation` |
| Existing-demo analysis contradicts browser evidence | Direct verification (capture) outranks retrospective analysis | Browser evidence is authoritative for product-behavior claims; analysis findings remain valid for narrative-quality context only |
| Screenshot and assertion disagree (assertion fails on a screen that "looks" successful) | Assertion (typed check) outranks visual impression | `status: failed` on the assertion is authoritative regardless of screenshot appearance |
| Hero Interaction selection differs between RFC-0002 and RFC-0003 | See resolution order below | Recorded as `hero-interaction-conflict` decision |
| Required claim has failed evidence | Contradiction must remain visible | A mandatory `limitation` beat MUST be generated for that claim (see §40.3 for whether this is unconditionally mandatory) |
| Result exists without visible cause | Structural invariant, not a contradiction per se | Rejected per §9's causal-necessity invariant |

**Hero Interaction conflict resolution order**: (1) if RFC-0004 `BrowserCaptureResult.observationTimeline` verifiably completed an interaction matching RFC-0002's `selectedHeroInteraction.candidateId`, that wins; (2) else if RFC-0003's `heroInteraction.status === "identified"` and RFC-0002 has no `selectedHeroInteraction`, RFC-0003's wins; (3) else if both exist and disagree with neither verified by capture, RFC-0002's `selectedHeroInteraction` wins (it carries explicit `authority: "human"|"manifest-policy"`) and the RFC-0003 candidate is recorded as a rejected alternative with `reasonCode: "conflicts-with-hero"`; (4) if neither source designates a Hero Interaction, `Storyboard.heroInteraction` is `null`.

**Core principles**:
- The engine MUST NOT silently choose the more flattering source.
- An unresolved **critical** contradiction MUST fail the Story Gate.
- A **non-critical** contradiction MAY produce a `limitation` beat or a `conditional` gate instead of blocking entirely.
- All conflicting provenance MUST be preserved in the `Storyboard` (via `uncertaintyNotes` and `StoryDecision.options`/`tradeoffs`), never deleted for tidiness.

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
  readonly heroInteractionCovered: boolean;
  readonly resultCovered: boolean;
  readonly ctaRequired: boolean;
  readonly ctaCovered: boolean;
  readonly narrativeCoverageRatio: number;   // [0,1]
  readonly proofCoverageRatio: number;       // [0,1]
  readonly sufficient: boolean;
};
```

Ratios MUST NOT hide critical missing elements: `sufficient` MUST be `false` whenever `coveredCriticalClaimCount < criticalClaimCount`, `heroInteractionCovered` is `false` while a Hero Interaction was expected, or `resultCovered` is `false` while the arc requires a `result` beat — regardless of how high `narrativeCoverageRatio` computes numerically. A high ratio with a missing critical element MUST still report `sufficient: false`.

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

### PASS requires

- Valid upstream inputs (all referenced artifact/run IDs resolve; no dangling provenance).
- No unresolved critical contradiction (§22).
- The selected narrative arc's required beats are all present and satisfied.
- Hero Interaction is `continuityStatus: "complete"` whenever `ProductUnderstanding.selectedHeroInteraction` or an equivalent RFC-0003 identification exists.
- All critical claims are covered (`coveredCriticalClaimCount === criticalClaimCount`).
- At least one `verified` proof chain exists for every critical demonstrated claim.
- `resultCovered` is `true` whenever the arc promises a result.
- Duration fits the permitted range (`allocatedMs` within `[minimumMs, maximumMs]`) or was validly compressed to fit.
- All scene dependencies resolve (no dangling `dependsOnSceneIds`).
- No scene with `priority: "critical"` is `unsupported`.
- Every critical scene has at least one renderer-usable artifact reference (a `browser-screenshot`, `browser-dom`, or explicit recapture requirement) — a critical scene with zero usable visual artifact and no recapture plan cannot pass.

### CONDITIONAL examples

- A non-critical claim is omitted.
- CTA is weak, generic, or entirely optional and absent (when not required by objective).
- Partial (not verified) proof exists for a supporting (not critical) claim.
- Minor duration compression was applied without removing any `mustAppear` scene.
- An optional sequence is missing.
- A low-confidence `context` scene remains in the storyboard.
- `result` exists but the generalized `impact` beat remains unverified.
- A non-critical scene requires renderer recapture (no pre-existing artifact, but a recapture path is defined).

### FAIL examples

- No valid story arc reaches minimum required-beat coverage.
- Missing critical proof (no `verified` `ProofChain` for a critical claim).
- Hero Interaction is `"broken"` while required.
- An unresolved critical contradiction exists (§22).
- An unsupported critical claim remains in the storyboard.
- A `result` beat/scene is present with no valid upstream cause (fabricated result).
- Scene or sequence dependencies are cyclic.
- Storyboard remains over budget after full compression with no valid further compression (§18).
- No renderer-usable evidence exists for any critical scene.
- Any referenced source ID fails to resolve.
- A critical claim is represented only by transcript text or narrative declaration with no visual/state corroboration.
- A `proof` scene is ordered before the `cause` scene it is meant to prove.
- The storyboard is empty (zero scenes).
- An upstream gate (`UnderstandingGate`, `ExistingDemoAnalysisGate`, `BrowserCaptureGate`) reports `fail` and no diagnostic-mode override applies (§26).

### Failure category taxonomy

To keep gate decisions explainable, every `blockingReasons` entry MUST be classifiable into exactly one of: `invalid-input`, `insufficient-evidence`, `incomplete-narrative`, `duration-infeasibility`, `unsupported-claim`, `structural-failure`, `renderer-readiness-failure`. This classification SHOULD be encoded as a prefix or field on each blocking reason string (exact serialization left to the JSON Schema, §33) so downstream tooling can group failures without re-deriving the category from prose.

---

## 26. Upstream gate policy

| Upstream gate | Story Engine response |
|---|---|
| `UnderstandingGate: fail` | Compilation MUST be blocked (`fail`) unless `StoryCompilerInput.constraints` explicitly enables diagnostic mode (see below); a failed Understanding Gate means product facts themselves are not trustworthy enough to narrate promotionally. |
| `UnderstandingGate: conditional` | Compilation proceeds; every warning MUST propagate into `StoryGate.warnings`. |
| `ExistingDemoAnalysisGate: fail` | Compilation MAY proceed — a failed *analysis* of a prior demo attempt is itself valid negative evidence (e.g., for a `limitation` beat) but MUST NOT be used as a source of validated narrative *quality* signal (e.g., its `DemoScore` MUST NOT be cited as evidence that the new storyboard is good). |
| `ExistingDemoAnalysisGate: conditional`/`pass` | Findings usable per §8 eligibility (`analysis-finding` sourceType, `context`-role only, per §8). |
| `BrowserCaptureGate: fail` | The failed capture run MUST NOT be used to construct any `verified` `ProofChain`. Its `passed` assertions, if individually still valid, MAY still support `partial`-status chains at most, and the failure itself MUST be surfaced (e.g., as a `limitation` beat candidate) rather than discarded. |
| `BrowserCaptureGate: conditional`/`pass` | Standard eligibility rules (§8) apply. |
| Multiple capture runs supplied | Only accepted with explicit precedence: the most recent run (`BrowserCaptureResult` with the latest `capturedAt`/`runId` ordering, per the `StoryCompilerInput.browserCaptures` array order — first element is authoritative unless `constraints` specify otherwise) is authoritative for a given claim; conflicting older runs are retained as `uncertaintyNotes`, not silently dropped. See §40.5. |
| Stale/mismatched run IDs | MUST be rejected at input validation (§27) — a `BrowserCaptureResult.capturePlanId` that does not correspond to any known target in the supplied `ProductUnderstanding`/DIR is an invalid input, not a warning. |

**Diagnostic vs. promotional storyboards**: RFC-0005 permits an explicit **diagnostic story mode** (activated via a `StoryConstraint`, e.g. `{ kind: "mode", value: "diagnostic" }`) in which: (a) a failed `UnderstandingGate`/`BrowserCaptureGate` does not automatically block compilation, (b) `limitation` beats are permitted (indeed expected) to dominate the narrative, (c) `call-to-action` beats are never required regardless of `objective`, and (d) the resulting `Storyboard` MUST be tagged (field TBD in JSON Schema, e.g. `storyMode: "diagnostic"`) so RFC-0006 and any downstream consumer cannot mistake it for a promotional demo plan. Default mode (no constraint supplied) is promotional, with the blocking behavior described in the table above.

---

## 27. Input contract

```ts
// DRAFT CONTRACT
type StoryConstraint = {
  readonly kind: "mode" | "max-scene-duration" | "cta-required" | "hero-interaction-required" | "arc-override" | string;
  readonly value: unknown;
  readonly reason: string;
};

type StoryCompilerInput = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly productUnderstanding: ProductUnderstanding;
  readonly dir: DemoIntermediateRepresentation;
  readonly existingDemoAnalysis?: ExistingDemoAnalysis;
  readonly browserCaptures: readonly BrowserCaptureResult[];
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

- **Required**: `productUnderstanding`, `dir`, `audience`, `objective`, `duration`. `browserCaptures` MAY be an empty array (a Storyboard MAY reach at most `conditional`/`fail` — never `pass` on critical proof — without browser evidence, since screenshots/DOM alone cannot verify function per §8).
- **Optional**: `existingDemoAnalysis`, `constraints` (defaults to `[]`).
- **Compatibility**: `productUnderstanding.schemaVersion` MUST be `"0.2"`, `dir.schemaVersion` MUST be `"0.2"`, `existingDemoAnalysis.schemaVersion` MUST be `"0.1"`, each `browserCaptures[i].schemaVersion` MUST be `"0.1"` — a mismatch is an `invalid-input` compile failure, not a warning (per the project's existing single-schema-per-artifact convention).
- **Precedence**: when `dir` and `productUnderstanding` disagree on required claims, DIR is authoritative for *what the demo must accomplish*; `productUnderstanding` is authoritative for *what is actually true*. A DIR-required claim with no `productUnderstanding` backing is a §22-style contradiction (`insufficient-evidence`), not silently satisfied by DIR's assertion alone.
- **Run identity checks**: every `browserCaptures[i].capturePlanId`/`targetId` MUST correspond to a target referenced (directly or transitively via evidence bridge, per RFC-0004 §"ProductUnderstanding evidence bridge") within the supplied `productUnderstanding`. Non-corresponding entries are rejected at validation (`invalid-input`).

---

## 28. StoryCompiler output and engine responsibilities

Proposed pure, stateless components (I/O — reading YAML, writing artifacts — stays entirely outside these, in the future CLI layer per §32, matching the RFC-0002–0004 `Engine<I,O>` pattern):

- **`StoryInputNormalizer`** — pure function: `StoryCompilerInput → NormalizedStorySources`.
- **`NarrativeBeatSelector`** — pure function: `NormalizedStorySources → { candidates: NarrativeBeat[], rejected: RejectedStoryCandidate[] }`.
- **`NarrativeArcSelector`** — pure function: `NarrativeBeat[] → { arc: NarrativeArc, coverage: Partial<StoryCoverage> }`.
- **`SceneCompiler`** — pure function: `(NarrativeBeat[], NarrativeArc) → { scenes: StoryScene[], rejected: RejectedStoryCandidate[] }`.
- **`SequenceCompiler`** — pure function: `(StoryScene[], NarrativeArc) → StorySequence[]`.
- **`DurationAllocator`** — pure function: `(StoryScene[], StorySequence[], budget) → { scenes: StoryScene[], durationBudget: StoryDurationBudget }`.
- **`StoryGateEvaluator`** — pure function: `(Storyboard-in-progress) → StoryGate`.
- **`StoryboardCompiler`** — pure function composing the above into a full `Storyboard`.
- **`StoryEngine`** — orchestration wrapper implementing the RFC-0001 `Engine<StoryCompilerInput, Storyboard>` interface (`validate`, `run`, `verify`, `metrics`, `decisionsFromLastRun`), matching the existing engine convention used by RFC-0002–0004.

### Pipeline (engine responsibility list)

1. validate input
2. normalize provenance
3. generate candidates
4. select beats
5. choose arc
6. construct scenes
7. construct sequences
8. protect Hero Interaction
9. build proof chains
10. allocate duration
11. compute coverage and metrics
12. evaluate Story Gate
13. emit decisions
14. verify output

Steps 1–12 (excluding orchestration bookkeeping) MUST be pure deterministic functions with no I/O; only the CLI layer (§32) performs file/network I/O, matching `capture-browser.ts`'s existing separation of engine logic from CLI plumbing.

---

## 29. Determinism

- **Stable source ordering**: story sources are processed in a fixed order — `productUnderstanding` fields first (in their own declared array order), then `dir`, then `existingDemoAnalysis` if present, then `browserCaptures` in input-array order.
- **Stable candidate IDs**: generated as deterministic slugs from `(sourceType, sourceItemId, beatKind)` tuples, not random UUIDs or counters seeded by wall-clock time.
- **Stable tie-breaking**: ties in scoring (§20) are broken first by `requirementCriticality`, then by `sourceItemId` lexical order — never by insertion order alone, which could vary across otherwise-equivalent input serializations.
- **Stable scene ordering**: fixed by the arc's required beat-kind order, then by `sourceItemId` lexical order within the same kind.
- **Stable rejection reasons**: the same input MUST always produce the same `reasonCode` for the same rejected candidate.
- **Stable JSON key/array policies**: object keys serialize in the order declared by the TypeScript contract (matching existing RFC-0001–0004 artifact conventions); arrays never reorder based on Map/Set iteration order — sort explicitly before serializing.
- **Timestamps isolated from semantic comparison**: `createdAt` on `StoryDecision` and any per-run metadata MUST be excluded from equality/golden-fixture comparison (test harness compares all fields except timestamp fields), consistent with how RFC-0001–0004 already isolate `createdAt`/`runId` from content hashing.
- **No random selection, no locale-sensitive ordering** (string sorts MUST use ordinal/codepoint comparison, not locale collation), **no hidden environment dependence, no model calls** in the reference implementation.

### Allowed nondeterministic metadata (documented separately, excluded from determinism guarantees)

`runId`, `createdAt`/`ISODateTime` fields, and `ArtifactEnvelope.contentHash` (which is itself a deterministic function of payload but naturally varies if payload varies) — these are metadata about *when/which run produced this*, not semantic content, and MUST be excluded from any "is this storyboard the same" comparison.

---

## 30. Renderer boundary

### RFC-0005 supplies to RFC-0006

- Ordered scenes (`StoryScene[]` in final compiled order).
- Duration targets and ranges per scene.
- Evidence/artifact references (`StoryEvidenceReference[]`, resolvable back to RFC-0004 screenshot/DOM artifacts).
- Semantic presentation intent (`ScenePresentationIntent`).
- Transition intent (`StoryTransitionIntent`).
- Text/voice *purpose* (`textIntent`, `voiceIntent` — semantic categories, not prose).
- Must-show and must-not-show constraints (`mustAppear`, `mustNotAppearWith`).
- Proof-chain requirements (`ProofChain[]`, so the renderer knows which visual elements must be legible for a scene to actually prove its claim).
- Confidence and uncertainty (`confidence`, `uncertaintyNotes`).
- Renderer-readiness status (per-scene, derived from `artifactPreference` + actual artifact availability — part of Story Gate, see §40.9 for whether this should be a separate gate).

### RFC-0005 does NOT supply

React components, frame numbers, exact keyframes, CSS, layouts, fonts, colors, easing curves, audio files, final captions, pixel crop coordinates, final voiceover prose, export settings.

**Renderer contract**: RFC-0006 MUST NOT reorder `mustAppear`/critical scenes, MUST NOT omit any scene with `mustAppear: true` or any `ProofChain` with `status: "verified"` feeding a critical claim, without producing an explicit renderer-side validation failure that a caller can observe (RFC-0005 does not specify that failure's shape, only that it MUST exist and MUST be distinguishable from a successful render). This boundary is what makes the Storyboard a binding plan rather than a mere suggestion.

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
| `storyboard.json` | Required (the primary `Storyboard` output) |
| `story-coverage.json` | Required |
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
- Schema validation, then semantic validation, before compilation begins.
- Deterministic compilation (§29) — running twice on the same input produces byte-identical `storyboard.json` modulo the excluded timestamp fields.
- Artifact persistence through the existing `FilesystemArtifactRegistry`.
- Concise console summary: run directory, `StoryGate.status`, scene/sequence counts, coverage ratios.
- Exit code 0 for `pass`/`conditional`, non-zero for invalid input or `fail`, via the existing `determineExitCode(success, gateStatus)` helper.
- MUST NOT print sensitive DOM content or filled form values (these were already sanitized upstream by RFC-0004; the CLI additionally MUST NOT re-surface raw `BrowserDomSnapshotArtifact` content in console output).
- No browser execution, no renderer execution, no network access — this CLI is a pure compiler over already-captured artifacts.

---

## 33. JSON Schemas

Proposed schema files (mirroring the existing `*.schema.json` convention):

- `story-compiler-input.schema.json`
- `narrative-beat.schema.json`
- `story-scene.schema.json`
- `story-sequence.schema.json`
- `storyboard.schema.json`
- `story-gate.schema.json`

**`schemaVersion` strategy**: each schema starts at `"0.1"`, independently versioned per artifact type, following the existing project convention (§ research: `ProductUnderstanding`/`DIR` are `"0.2"`, `ExistingDemoAnalysis`/`BrowserCaptureResult` remain `"0.1"` — versions bump only when that specific artifact's own contract changes, not in lockstep). Backward compatibility: a schema version bump within RFC-0005's artifacts MUST NOT silently reinterpret an existing field's meaning — additive fields are permitted within a `"0.x"` version; a meaning-changing field requires a version bump and an explicit migration note in this RFC's changelog (to be added when the first breaking change occurs).

---

## 34. Validation invariants

Consolidated checklist (every implementation MUST verify these before emitting a `Storyboard`):

- All IDs (beats, scenes, sequences, evidence references, proof chains) are unique within the Storyboard.
- All references (beat→evidence, scene→beat, scene→scene, sequence→scene) resolve to an existing entity in the same Storyboard.
- All `confidence` values are in `[0, 1]`.
- All `durationRangeMs` are valid (`minimum ≤ target ≤ maximum`, `minimum ≥` reference minimum readable duration).
- No cyclic dependencies among scenes (`dependsOnSceneIds`) or beats (`dependencies`).
- Scene `order` is unique within its sequence; sequence `order` is unique within the Storyboard.
- All beats with `mustAppear: true` (or belonging to the selected arc's required set) are placed in at least one scene.
- Hero Interaction causal order is valid (§16).
- Every `proof`-kind scene uses evidence eligible for `role: "proof"` per §8.
- Every `result`-kind scene has a resolvable upstream cause per §9.
- No CTA scene introduces a claim not already substantiated earlier in the Storyboard.
- No candidate appears in both `rejectedCandidates` and the final `beats`/`scenes` arrays.
- All `StoryCoverage` ratio fields are in `[0, 1]`.
- `StoryGate.status` is consistent with the actual presence/absence of blocking conditions (no `pass` with a non-empty category-`structural-failure`/`unsupported-claim` reason in `blockingReasons`, and vice versa — `fail` MUST have a non-empty `blockingReasons`).
- Source provenance (`sourceArtifactIds`, `StoryEvidenceReference.sourceArtifactId`/`sourceItemId`) is preserved end-to-end, never replaced with a synthetic ID.
- No evidence reference is labeled `verified` when its originating upstream record was not itself `verified`/`passed`.
- No renderer-specific implementation detail (CSS, component names, pixel values, easing curves) appears anywhere in the Storyboard.
- No `critical`-importance beat/scene remains `unsupported` in the final output.
- No orphan scenes (a scene with `sequenceId` not present in `sequences`, or a scene never referenced by any sequence's `sceneIds`).
- No `required: true` sequence has an empty `sceneIds`.

---

## 35. Testing strategy for future implementation

The future implementation MUST include unit tests per pure function (§28 components), integration tests for the full `StoryEngine.run()` pipeline, JSON Schema conformance tests for every artifact in §33, golden-fixture regression tests (fixed input → fixed expected output, diffed field-by-field excluding timestamps), and determinism tests (run twice, assert structural equality). Required cases:

- Minimal valid story (shortest arc that reaches `pass`).
- Missing Hero Interaction (both "product genuinely has none" and "candidates conflict unresolved").
- Proof screenshot without assertion → `partial` proof chain, not `verified`.
- Verified proof chain (passed assertion + linked artifact).
- Failed assertion → `unsupported` proof chain, possible `limitation` beat.
- Conflicting product facts (two `Fact` records disagree) → §22 resolution.
- Conditional upstream gate (`UnderstandingGate: conditional`) → warnings propagate, compilation proceeds.
- Failed upstream gate (`UnderstandingGate: fail`, non-diagnostic mode) → compilation blocked.
- Duplicate beats (two candidates for the same claim/kind) → one rejected `duplicate`.
- Competing scene candidates → `stronger-evidence-selected` resolution.
- Stable tie-breaking (two candidates with identical scores) → deterministic winner by `sourceItemId`.
- Budget compression (target duration forces scene shrink, not removal).
- Impossible budget (even minimums exceed maximum) → `fail`, `overBudgetMs` reported.
- Optional CTA (objective = `explain`) → CTA absence does not block `pass`.
- Required CTA (objective = `persuade-to-buy`) → CTA absence blocks at least `conditional`.
- API product story (arc = `claim-demonstration-verification`).
- Infrastructure story (arc = `diagnosis-intervention-result`).
- Before/after story (arc = `before-interaction-after`).
- Diagnostic story (mode constraint set, failed gates don't block, no CTA required).
- Rejected unsupported claim (`Claim` with empty `evidenceIds`).
- Renderer-ready vs. renderer-not-ready scenes (artifact availability check).
- Deterministic repeated compilation (byte-identical output modulo timestamps, run 2+ times).
- All RFC-0001 through RFC-0004 existing regressions remain unchanged (RFC-0005 MUST NOT modify any existing engine, contract, or test).

---

## 36. Worked examples

### Example A — Valid workflow-product demo (local TrustCheck-style fixture)

**Normalized inputs** (abridged): `productUnderstanding` names product `"TrustCheck"`, problem `"manual vendor risk review takes days"`, `selectedHeroInteraction` pointing at candidate `hero-vendor-scan`. `dir` sets `goal: "demonstrate"`, `durationSeconds: 90`, `heroInteractionSceneId: "scene-vendor-scan"`. One `browserCaptures[0]` entry with a passed assertion `assert-scan-complete` linked to screenshot `shot-scan-result`.

**Selected arc**: `problem-solution-proof` (a `problem` candidate at confidence 0.75 exists; `workflow-friction-compression` scored lower because only one manual-step observation was present, not multiple).

**Candidate beats (abridged)**:
```json
[
  { "id": "beat-problem-01", "kind": "problem", "confidence": 0.75, "importance": "important", "verificationStatus": "verified" },
  { "id": "beat-intro-01", "kind": "product-introduction", "confidence": 0.9, "importance": "important", "verificationStatus": "verified" },
  { "id": "beat-start-01", "kind": "interaction-start", "confidence": 0.85, "importance": "critical", "verificationStatus": "verified" },
  { "id": "beat-complete-01", "kind": "interaction-complete", "confidence": 0.9, "importance": "critical", "verificationStatus": "verified" },
  { "id": "beat-proof-01", "kind": "proof", "confidence": 0.95, "importance": "critical", "verificationStatus": "verified", "evidenceRefs": [{ "sourceType": "browser-assertion", "sourceItemId": "assert-scan-complete", "role": "proof", "verificationStatus": "verified" }] },
  { "id": "beat-result-01", "kind": "result", "confidence": 0.8, "importance": "important", "verificationStatus": "verified" }
]
```

**Selected beats**: all six above. **Rejected**: a candidate `hook` beat sourced from an unverified `Hypothesis` (`reasonCode: "low-confidence"`, confidence 0.4 < threshold).

**Scenes**: `scene-problem` (primary `beat-problem-01`), `scene-intro`, `scene-vendor-scan-start` → `scene-vendor-scan-complete` (Hero Interaction), `scene-proof` (requires `assert-scan-complete`), `scene-result` (`dependsOnSceneIds: ["scene-vendor-scan-complete", "scene-proof"]`).

**Hero Interaction**: `startSceneId: "scene-vendor-scan-start"`, `completionSceneId: "scene-vendor-scan-complete"`, `proofSceneIds: ["scene-proof"]`, `resultSceneId: "scene-result"`, `continuityStatus: "complete"`.

**Proof chain**: `{ claimId: "claim-scan-accuracy", assertionIds: ["assert-scan-complete"], evidenceArtifactIds: ["shot-scan-result"], proofSceneIds: ["scene-proof"], resultSceneIds: ["scene-result"], status: "verified", gaps: [] }`.

**Duration allocation**: target 90000 ms → problem/intro (setup) 18000 ms (20%, under the 25% ceiling), Hero Interaction 27000 ms (30%, above the 20% floor), proof 18000 ms (20%, above the 15% floor), result 13500 ms, CTA 4500 ms (5%, under the 10% ceiling). `overBudgetMs: 0`, `compressionApplied: false`.

**Story Gate**: `status: "pass"` — critical claim `claim-scan-accuracy` covered by a `verified` proof chain, Hero Interaction complete, result covered, duration fits. `warnings: ["hero interaction rejected a low-confidence hook beat"]`.

### Example B — Screenshot without functional proof

Inputs identical to Example A except `browserCaptures[0]` contains **no assertions**, only `screenshots: [{ id: "shot-scan-result", stepId: "step-scan" }]`.

**Candidate `proof` beat**: cites `{ sourceType: "browser-screenshot", sourceItemId: "shot-scan-result", role: "proof", verificationStatus: "unverified" }`. Per §8 eligibility, a screenshot alone cannot support `role: "proof"`. This candidate is **rejected**: `{ reasonCode: "unsupported", explanation: "screenshot-only evidence cannot establish role: proof; no passed assertion available", conflictingWithIds: [], replacedByIds: [] }`.

**Resulting proof chain**: `{ claimId: "claim-scan-accuracy", assertionIds: [], evidenceArtifactIds: ["shot-scan-result"], proofSceneIds: [], resultSceneIds: [], status: "unsupported", gaps: ["no passed assertion available for claim-scan-accuracy"] }`.

**Effect on beats**: no `proof`-kind beat reaches `verificationStatus: "verified"`; the candidate is either dropped or re-typed as a `context`-role beat showing the scan screen without claiming it as proof.

**Story Gate**: since `claim-scan-accuracy` is `importance: "critical"` and has no `verified` proof chain, `status: "fail"`, `blockingReasons: ["missing critical proof: claim-scan-accuracy has no verified ProofChain"]`. If the claim were instead `importance: "supporting"`, the gate would be `"conditional"` with a warning about partial proof, not `"fail"`.

### Example C — Contradictory evidence

`productUnderstanding.claims` includes `claim-always-succeeds: "vendor scan always completes without manual review"`, sourced from the manifest (`sourceType: "manifest"`, `verificationStatus: "unverified"` at the claim level pending capture). `browserCaptures[0].assertions` includes `assert-scan-complete: { status: "failed", message: "scan timed out awaiting manual review queue" }`.

**Contradiction detected**: manifest claim asserts unconditional success; browser evidence directly contradicts it. Per §22, verified capture evidence outranks the unsupported manifest declaration.

**Promotional mode** (`objective: "persuade-to-buy"`, default mode): the `proof`/`result` beats for `claim-always-succeeds` are rejected (`reasonCode: "unsupported"`); since this is a `critical` claim per DIR, `Story Gate: fail`, `blockingReasons: ["unresolved critical contradiction: claim-always-succeeds contradicted by assert-scan-complete (failed)"]`.

**Diagnostic mode** (`constraints: [{ kind: "mode", value: "diagnostic", reason: "internal QA review" }]`): the failed assertion instead generates a `limitation` beat (`beat-limitation-01: "vendor scan does not always complete without manual review — timed out in observed run"`, `evidenceRefs: [{ sourceType: "browser-assertion", sourceItemId: "assert-scan-complete", role: "limitation", verificationStatus: "verified" }]`). The Storyboard is tagged `storyMode: "diagnostic"`, has no `call-to-action`, and MAY reach `conditional` (the contradiction is now honestly represented, not hidden) rather than `fail`.

---

## 37. Security and privacy

- Story artifacts MUST contain **references** to evidence (artifact ID + item ID), never copies of raw sensitive values — the Storyboard points at RFC-0004's already-sanitized `BrowserDomSnapshotArtifact`/`BrowserScreenshotArtifact`, it does not re-embed DOM/pixel content.
- No cookies, tokens, headers, or form values may appear anywhere in a Storyboard, beat, scene, or decision — these were already excluded upstream by RFC-0004's sanitization; RFC-0005 MUST NOT reintroduce them via, e.g., an incautious `whyThisSceneExists` string that quotes raw captured text.
- Source labels (e.g., `sourceItemId` strings) MUST be sanitized identifiers, not raw content.
- No accidental transcript or DOM dump: `purpose`/`explanation`/`whyThisSceneExists` free-text fields MUST be generated from template strings referencing IDs and counts, not by concatenating raw upstream text blobs.
- No data amplification through narrative summaries: an `impact` beat MUST NOT restate a sensitive `Fact` in more detail than the original evidence disclosed.
- `sanitization`/redaction status from RFC-0004 artifacts (`BrowserDomSnapshotArtifact.sanitization`) MUST be preserved through any `StoryEvidenceReference` pointing at that artifact — the reference does not strip the flag.
- Uncertain or incomplete redaction on an upstream artifact MUST propagate to reduce that scene's renderer-readiness — a scene referencing an artifact with unclear sanitization status MUST NOT be marked renderer-ready without an explicit override decision.

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
- Voice and caption compiler (turning `voiceIntent`/`textIntent` into actual prose — likely RFC-0007 territory per §40.13).
- Renderer feedback loop (RFC-0006 reporting back what actually rendered, closing the loop).
- Critic engine (automated quality critique beyond `StoryMetrics`).
- Story A/B variants.
- Learning from successful demos (no ML training loop in scope).

---

## 40. Open questions

1. **Should one beat belong to multiple scenes?**
   Tradeoff: allowing it simplifies reuse (e.g., one `product-introduction` beat referenced by both a hook-adjacent teaser scene and its full scene) but complicates duration accounting and `mustAppear` propagation (removing one scene could silently starve another beat's only carrier).
   Recommendation: **No** — a beat belongs to exactly one scene in v0.1; `beatIds` on a scene is a list because a scene may carry multiple beats, but the inverse (one beat, many scenes) is disallowed to keep duration/coverage accounting unambiguous.
   Status: **recommended for v0.1**.

2. **Can one scene belong to multiple sequences?**
   Tradeoff: reuse across sequences (e.g., a scene serving both `demonstration` and `proof`) vs. clean sequence-level duration budgeting.
   Recommendation: **No** — `StoryScene.sequenceId` is singular. If a scene logically serves two purposes, it should be split, or the sequence boundary reconsidered (proof chains may still *reference* scenes across sequences per §12 without the scene itself being multi-owned).
   Status: **recommended for v0.1**.

3. **Should failed assertions ever generate mandatory limitation scenes?**
   Tradeoff: mandatory generation guarantees honesty but risks cluttering every storyboard with limitation beats for minor, non-critical failures.
   Recommendation: mandatory only when the failed assertion blocks a **critical** claim's proof chain (i.e., exactly the case in §22's "required claim has failed evidence" row); non-critical failed assertions produce an optional/candidate limitation beat, not a mandatory one.
   Status: **recommended for v0.1** (scoped as above).

4. **Should CTA be required only for persuasive objectives?**
   Tradeoff: the RFC prompt's own §6 table already marks `call-to-action` as "conditional," and §14 proposes exactly this rule.
   Recommendation: **Yes**, as already encoded in §14 — required for `persuade-to-try`/`persuade-to-review`/`persuade-to-buy`, optional otherwise, never required for `explain`/`document`/diagnostic mode.
   Status: **recommended for v0.1**.

5. **Should the Story Engine accept multiple browser capture runs?**
   Tradeoff: multiple runs give resilience against one flaky capture, but require a precedence rule (§26) to avoid ambiguity about which run is authoritative for a given claim.
   Recommendation: **Yes**, accept an array (`browserCaptures: readonly BrowserCaptureResult[]`) with array-order precedence as specified in §26, and require explicit `capturePlanId`/`targetId` correspondence at validation.
   Status: **recommended for v0.1** (contract already reflects this).

6. **How should conflicting Hero Interaction selections be resolved?**
   Tradeoff: automatic resolution (§22's proposed order) is convenient but may occasionally pick the "wrong" one when a human's RFC-0002 selection is stale relative to fresh RFC-0004 capture evidence.
   Recommendation: use the deterministic precedence order in §22 (capture-verified match > RFC-0003 only > RFC-0002 `authority: human` > null), but always record the conflict as a `StoryDecision` with `authority: "engine"` and `reversible: true`, so a human can override in a future run without needing this RFC amended.
   Status: **recommended for v0.1**.

7. **Should diagnostic and promotional story modes use separate contracts?**
   Tradeoff: separate types (`DiagnosticStoryboard` vs. `PromotionalStoryboard`) give stronger compile-time guarantees but duplicate most of the contract; a single `Storyboard` with a `storyMode` discriminant field is simpler but relies on runtime checks.
   Recommendation: single `Storyboard` type with a `storyMode: "promotional" | "diagnostic"` field (§26) for v0.1; revisit a split only if diagnostic-mode-specific fields proliferate.
   Status: **recommended for v0.1**, **defer** the type-split question until real usage data exists.

8. **Should duration defaults exist when DIR provides no target?**
   Tradeoff: a default (e.g., 90s) unblocks compilation conveniently but risks silently picking a duration nobody asked for, contradicting the "never invent" principle at a structural level.
   Recommendation: **No silent default** — §18 already specifies `fail` with `invalid-input` when no target is supplied and no constraint override exists. A future `StoryConstraint` MAY explicitly opt into a documented reference default, but that must be an explicit caller choice, not implicit compiler behavior.
   Status: **recommended for v0.1** (already reflected in §18).

9. **Should renderer readiness be part of Story Gate or a separate gate?**
   Tradeoff: folding it into `StoryGate` keeps one pass/conditional/fail surface for callers to check; a separate `RenderReadinessGate` cleanly separates "is this a good story" from "can this actually be rendered right now."
   Recommendation: keep renderer-readiness as a **contributing factor within `StoryGate`** for v0.1 (as drafted in §25's PASS criteria) rather than a second gate, since RFC-0005 has no renderer of its own to gate separately from — but flag this for reconsideration once RFC-0006 exists and may want its own gate that consumes `StoryGate` as one input.
   Status: **recommended for v0.1**, **requires owner decision** once RFC-0006 scope is drafted.

10. **Should proof chains reference assertions directly or only normalized evidence?**
    Tradeoff: direct assertion references (`assertionIds: BrowserAssertionResult["id"][]`) are precise and traceable but couple `ProofChain` tightly to RFC-0004's shape; routing everything through `StoryEvidenceReference` first is more uniform but adds an indirection layer.
    Recommendation: **direct references**, as drafted in §17 (`assertionIds`, `evidenceArtifactIds`) — precision and auditability matter more than uniformity here, and `StoryEvidenceReference` already exists at the beat/scene level for the uniform case.
    Status: **recommended for v0.1**.

11. **Should unsupported impact claims be omitted or represented as explicit hypotheses?**
    Tradeoff: omission is safest but loses potentially valuable framing; explicit hypothesis-labeling preserves framing while being honest about its status.
    Recommendation: represented as explicit hypotheses (already the §7 rule: an `impact` beat sourced from a `Hypothesis` stays `verificationStatus: "unverified"` with `uncertaintyNotes`, never omitted outright) — this matches the evidence-first philosophy of preserving uncertainty rather than deleting it.
    Status: **recommended for v0.1** (already reflected in §7).

12. **Should Narrative Arc selection be fixed by input or chosen deterministically?**
    Tradeoff: caller-fixed arc (via `StoryConstraint`) gives control but risks a caller forcing an arc the evidence doesn't support; deterministic selection (§15) is safer but less steerable.
    Recommendation: deterministic selection by default (§15's scoring procedure), with an `arc-override` `StoryConstraint` as an explicit escape hatch that still must pass the same required-beat coverage check — an override that would fail coverage still produces a `conditional`/`fail` gate, it does not bypass validation.
    Status: **recommended for v0.1** (already reflected in §15/§27).

13. **How much text/voice intent belongs in RFC-0005 versus RFC-0007?**
    Tradeoff: RFC-0005 needs enough voice/text *intent* (`voiceIntent`, `textIntent` enums, §10) for RFC-0006 to know a scene needs, e.g., a "metric" callout — but actual prose generation is a distinct, potentially LLM-involving concern that shouldn't live in a deterministic compiler.
    Recommendation: RFC-0005 owns only the closed-enum *intent* (as drafted in §10); a future RFC-0007 (voice/caption compiler, already listed as a future extension in §39) owns turning that intent into actual text/audio. This RFC does not reserve or number RFC-0007 beyond noting the boundary.
    Status: **recommended for v0.1** (boundary as drafted), **defer** RFC-0007 scoping itself.

14. **Should the reference implementation produce one storyboard or ranked alternatives?**
    Tradeoff: ranked alternatives give callers choice but roughly double the surface to validate/gate and reintroduce ambiguity about which one is "the" plan RFC-0006 should render.
    Recommendation: **one storyboard** per compilation for v0.1 — deterministic compilation implies one canonical answer per input; a "tournament" of alternatives is explicitly deferred to §39's creative-divergence extension.
    Status: **recommended for v0.1**.

15. **Which Story Gate conditions are truly blocking for v0.1?**
    Tradeoff: an overly strict `fail` list blocks legitimate demos over minor gaps; an overly permissive list lets weak demos through as `pass`.
    Recommendation: the FAIL list in §25 as drafted — it centers on exactly three failure families: (a) missing/broken proof for something the demo claims to prove, (b) structural impossibility (cycles, empty storyboard, unresolved IDs, causal-order violations), and (c) budget infeasibility with no valid compression. Everything else (non-critical gaps, weak CTA, optional sequences) is `conditional` at worst. This keeps `fail` reserved for genuinely broken or dishonest storyboards.
    Status: **recommended for v0.1** (already reflected in §25), **requires owner decision** on exact numeric thresholds (setup-proportion percentages, minimum scene duration) once real fixtures exist to calibrate against.

---

*End of RFC-0005 draft specification.*
