# RFC-0005 independent conformance audit

Auditor: independent agent session (not the implementing agent). Baseline: `7628114`
("docs: accept RFC-0005 Story Engine specification"). Implementation HEAD audited:
`41880df` ("docs: document RFC-0005 Story Engine implementation"), three commits:
`7188336` (contracts + engine), `87e3bd9` (tests), `41880df` (docs). Corrections in this
document were made on top of `41880df` in an isolated worktree; see the commit(s) added
by this audit for the exact diff.

## 0. Headline finding: the prior self-report's baseline-failure claim is false

The implementing agent's self-report claimed "202 passed, 11 pre-existing failures
(missing tsx binary), 2 skipped" for the full suite. Verified independently in two clean
worktrees (`npm install` run in each, no global installs):

- Baseline (`7628114`): 199 passed, 0 failed, 2 skipped (21 test files).
- HEAD (`41880df`, before this audit's corrections): 213 passed, 0 failed, 2 skipped (22
  test files — the 14 new `story-engine.test.ts` tests, all passing).
- HEAD after this audit's corrections (21 story-engine tests, +7 new): 220 passed, 0
  failed, 2 skipped (22 test files).

The "11 failures" and "missing tsx" claim does not reproduce under a normal `npm install`.
`tsx` is a listed `devDependency` and is present once `node_modules` exists; the claim
appears to be an artifact of running the suite without installing dependencies first, not
a genuine defect in either the baseline or the implementation. This is flagged because it
materially misrepresents environment health and should not be repeated in future reports.

## 1. Requirement-to-code traceability matrix

Legend: PASS = implemented and enforced in code, matching RFC text. PARTIAL = implemented
but narrower than the RFC's normative scope (documented, not silently missing). FAIL =
implemented in a way that contradicts the RFC (all FAILs found were corrected by this
audit — see §4). NOT TESTED = code path exists, no test exercises it directly. N/A = not
applicable to the reference implementation's declared scope (e.g. future-extension
hooks).

| # | Requirement (RFC section) | File / line (post-audit) | Status | Notes |
|---|---|---|---|---|
| 1 | Closed `NarrativeBeatKind` taxonomy, no emission outside it (§6) | `src/core/story.ts:19-38` (type), `src/engines/story.ts` (only 9 kinds ever constructed) | PASS (type-closed) / PARTIAL (generation breadth) | Type system prevents emitting an invalid kind; only 9/19 kinds are ever *selected as candidates*. See §4.C below — this is the "8/19" limitation, corrected count is 9/19. |
| 2 | `NarrativeBeat` invariants (§7): confidence∈[0,1], verified⇒evidence verified, hypothesis⇒unverified, critical⇒≥partially-verified+proof/result evidence, non-empty takeaway, DAG dependencies, non-empty claim/fact/evidence except next-step/CTA, purpose non-empty, exclusive beat ownership | `src/engines/story.ts` beat constructors; `clamp01` (`src/core/provenance.ts`) | PASS (post-audit) | The `sourceClaimIds`/`sourceFactIds` invariant was violated pre-audit for Hero-Interaction beats (empty both, non-empty `evidenceRefs`, kind not next-step/CTA) — **FAIL corrected**, see §4.A. Beat-ownership exclusivity verified by test (`tests/story-engine.test.ts:171-178`). |
| 3 | `StoryEvidenceReference` eligibility rules (§8) | `isEvidenceEligibleForRole()`, `src/core/story.ts:90-117` | PASS | Screenshot cannot support `proof`/`result`; failed assertion excluded via `verificationStatus` check; hypothesis→context-only enforced by construction (impact beats always `role: "context"`). NOT TESTED directly as a standalone unit (only exercised indirectly through engine behavior) — `isEvidenceEligibleForRole` itself has no dedicated unit test. |
| 4 | Scene model invariants (§9): exclusive `primaryBeatId`∈`beatIds`, exclusive beat ownership, resolvable ids, unique `order`, `mustAppear` protection, proof/result dependency requirements, CTA no-new-claim, duration range validity, acyclic deps, `mustNotAppearWith` mutual exclusion, presentation intent cannot satisfy evidence | `buildScenesAndSequences()`, `src/engines/story.ts:646-726` | PASS (structurally, by construction — one scene per beat makes most invariants trivially true) / NOT TESTED (`mustNotAppearWith`, `dependsOnSceneIds` cycle detection — never populated with a conflicting pair by the reference generator, so the invariant is vacuously satisfied rather than actively tested) | The one-scene-per-beat policy (§4.E) means several §9 invariants are satisfied by construction rather than by an active check — genuinely correct, but the checking *logic* (e.g. cycle detection) does not exist because it is never needed at this candidate-generation breadth. |
| 5 | `storyMode`/`rendererReadiness` required top-level fields (§9a, §13) | `Storyboard.storyMode`, `Storyboard.rendererReadiness` — both non-optional in the type, always populated in `run()` | PASS | Tested (`tests/story-engine.test.ts:197-206`, new renderer-readiness test). |
| 6 | Presentation/transition intent are semantic hints only, no renderer-specific values (§10-11) | `presentationIntentFor()`, `transitionInFor/Out()`, `src/engines/story.ts:728-767` | PASS | No CSS/pixel/Remotion-specific values found in `src/core/story.ts` or `src/engines/story.ts`. |
| 7 | Sequence ordering rules (§12): opening/context/problem before demonstration; demonstration before proof; proof before outcome; conclusion last; scene exclusivity | `SEQUENCE_ORDER`, `src/engines/story.ts:86-95`; sequence construction `src/engines/story.ts:714-723` | PASS | `SEQUENCE_ORDER` is a fixed array in RFC order; sequences filtered/ordered from it. Scene exclusivity tested (`tests/story-engine.test.ts:179-186`). |
| 8 | `Storyboard` contract shape + ID stability + serialization ordering (§13) | `src/core/story.ts:502-522`; `Storyboard.id = contentHashOf(...)`, `src/engines/story.ts:1347` | PASS | Stable-id test exists (`tests/story-engine.test.ts:336-341`). Scenes/sequences serialized in `order`; verified by determinism test. |
| 9 | Exactly one canonical `Storyboard` per compilation (§13, §14 non-goal) | `StoryEngine.run()` returns a single `Storyboard`; no ranking/tournament code exists anywhere in `src/engines/story.ts` | PASS | Structural — no alternate code path produces more than one. |
| 10 | Audience/objective contracts + CTA requirement policy (§14 Decision 4) | `resolveStoryMode`, CTA logic `src/engines/story.ts:514-535`; `computeCoverage` `ctaRequired` `src/engines/story.ts:895` | PASS | Tested (new: "requires a CTA for persuade-to-try...", "does not require a CTA for a non-persuasive objective"). Diagnostic-mode-never-requires-CTA also tested (pre-existing test). |
| 11 | Closed `NarrativeArc` set, selection procedure, override rules (§15) | `NARRATIVE_ARCS`, `src/core/story.ts:267-300`; `selectArc()`, `src/engines/story.ts:621-640` | PARTIAL | Selection logic itself is correct (score by required-beat coverage, tie-break by declaration order, override honored, override cannot manufacture missing beats). But because candidate generation only ever produces 9/19 beat kinds, 4 of the 8 arcs (`before-interaction-after`, `goal-obstacle-resolution`, `diagnosis-intervention-result`, `comparison-decision`) can never win the automatic selection — their required beats include kinds (`current-state`, `goal`, `mechanism`, `comparison`) this compiler never generates. This is the practical consequence of limitation §4.C below, now explicitly documented. Override path tested (new test). |
| 12 | Hero Interaction authority model (§16, Decision 6) — human authority for narrative importance, evidence for verifiability, no silent replacement | `resolveHeroInteraction()`, `src/engines/story.ts:237-286` | PASS | Human selection (`authority: "human"`) always wins `sourceHeroInteractionId`/`narrativeAuthority` regardless of verifiability; RFC-0003 analysis-derived only used absent human selection; no code path reassigns `narrativeAuthority` to a different interaction based on capture success. Tested (`tests/story-engine.test.ts:239-246`). Rule 6's "alternative captured in `alternativeVerifiedInteractionIds`" is **NOT implemented** — the field exists on the type but `resolveHeroInteraction`/the `HeroInteractionSequence` construction (`src/engines/story.ts:1287-1302`) always sets it to `[]`, even when the hero chain is broken but a *different* interaction-start/complete pair exists in the same observation timeline. NOT TESTED / PARTIAL — this is a real, minor gap (the field is dead) but does not violate the "no silent replacement" invariant since narrative authority itself is never reassigned. |
| 13 | Hero Interaction structural ordering rules (§16) | Scene `order` follows arc-declared beat order (`buildScenesAndSequences`) which places interaction-start before -complete before proof before result | PASS (by construction) | NOT TESTED directly — no test asserts `order(start) < order(complete) < order(proof) < order(result)` numerically; it holds because `NARRATIVE_ARCS[*].requiredBeats` is declared in that order and `buildScenesAndSequences` sorts by it. |
| 14 | `ProofChain` contract + rules (§17): `evidenceRefIds` canonical, verified/partial/unsupported eligibility, no confidence-stacking from duplicates, all chains retained | `buildProofChains()`, `src/engines/story.ts` (post-audit, see §4.B) | PASS (post-audit) | Pre-audit this was a **FAIL**: any passed assertion + proof/result scene marked *every* DIR evidence entry "verified" regardless of relevance — corrected, see §4.B. Multiple `ProofChain`s per claim: N/A in the reference implementation (only ever one chain is possible per claim since there is only one authoritative capture run and one proof/result scene globally) — the RFC's "MUST retain all of them" is vacuously satisfied because the implementation never generates more than one candidate per claim to begin with (consequence of §4.E). |
| 15 | Duration budget contract + Decision 8 (no silent default) + numeric policies never independently blocking (§18) | `allocateDuration()`, `src/engines/story.ts:824-869`; duration-invalid early-return, `src/engines/story.ts:1145-1259` | PASS (no-silent-default) / PARTIAL (compression) | No-silent-default tested (`tests/story-engine.test.ts:189-195`). Compression is a uniform even-split toward the 1500ms floor, not the RFC's priority-ordered (supporting→important, `mustAppear`/critical protected) shrink-then-remove search — see §4.F. Numeric-policy-never-blocking-alone is satisfied because the implementation never even computes setup/hero/proof/CTA proportions as blocking signals (`computeGate` has no proportion checks at all) — correct outcome, but for the trivial reason that the metric exists only in `StoryMetrics`, not because a policy check was deliberately excluded from blocking. |
| 16 | Candidate generation pipeline order (§19, 16 steps) | `StoryEngine.run()`, `src/engines/story.ts:1120-1376` | PASS (steps present, correctly ordered) / PARTIAL (step 6, candidate breadth; step 9, one-scene-per-beat vs. full scoring) | Steps 1-5, 8, 10-16 map directly to named function calls in the correct order. Step 6 (candidate generation) and step 9 (scene construction) are the narrowed steps discussed in §4.C/E. |
| 17 | Selection/rejection algorithm + `RejectedStoryCandidate`/`RejectionReasonCode` (§20) | `reject()` closure in `generateCandidateBeats`, `src/engines/story.ts:309-325`; `RejectionReasonCode` union `src/core/story.ts:369-384` | PARTIAL | Only beat-level rejection is implemented (`candidateType: "beat"` always) — no scene-level candidates are ever generated to reject, again a consequence of one-scene-per-beat (§4.E: there is no scene competition to have losers). The full weighted-scoring formula (§20's `score = w1·criticality + ...`) is explicitly not implemented — the RFC itself calls this "illustrative, not final," so this is not a non-conformity per se, but it means "stronger-evidence-selected" and several other reason codes are structurally unreachable in the current implementation (no two competing candidates for the same slot ever exist to compare). Rejection-code validity now tested (new test) — all codes emitted are drawn from the closed set. |
| 18 | `StoryDecision` contract + required decision kinds (§21) | `StoryDecision` type `src/core/story.ts:400-413`; decisions pushed in `run()` for `story-mode-resolved`, `capture-run-selected`, `hero-interaction-resolved`, `narrative-arc-selected`, `story-gate-computed` | PARTIAL | 5 of the RFC's 19 listed decision kinds (§21) are recorded: `story-mode-resolved`, `capture-run-selected`, `hero-interaction-resolved`, `narrative-arc-selected`, `story-gate-computed`. Missing: `audience-selected`, `objective-selected`, `arc-override-applied` (folded into `narrative-arc-selected`'s `authority: "human"` rather than a separate decision), `beat-selected`, `beat-rejected` (rejection is recorded in `rejectedCandidates`, not as a separate `StoryDecision`), `scene-selected`, `scene-rejected`, `sequence-merged`, `sequence-removed`, `proof-chain-accepted`, `proof-chain-rejected`, `duration-compressed`, `hero-interaction-override-applied`, `unverified-impact-admitted`, `renderer-readiness-computed`. This is a real, moderate documentation/traceability gap — the RFC says "each entry MUST include..." for these decision *kinds*, implying they should exist as decisions, not just be inferable from other fields. Not corrected in this pass (would require broad engine changes to add ~14 new decision-emission sites); flagged as a remaining item. |
| 19 | Contradiction handling table + failed-assertion/limitation-beat policy (Decision 3) + unsupported-impact policy (Decision 11) (§22) | Limitation-beat logic `src/engines/story.ts:471-511`; impact logic `src/engines/story.ts:538-574` | PASS | Both policies tested directly (pre-existing tests). |
| 20 | `StoryCoverage` contract + `sufficient` never hides critical gaps (§23) | `computeCoverage()`, `src/engines/story.ts:875-926` | PASS | `sufficient` correctly gates on `coveredCriticalClaimCount`, `heroInteractionCovered`, `resultCovered`, `ctaRequired`⇒`ctaCovered` — matches §23 text exactly. |
| 21 | `StoryMetrics` contract, fully decomposed (no opaque score) (§24) | `computeMetrics()`, `src/engines/story.ts:1041-1084` | PASS | No aggregate "quality score" field exists anywhere in the type or output. |
| 22 | `StoryGate` PASS/CONDITIONAL/FAIL rules, failure category taxonomy, numeric policies never independently blocking (§25) | `computeGate()`, `src/engines/story.ts:980-1035`; `classifiedReason()`, `src/core/story.ts:492-494` | PASS | Every FAIL condition in `computeGate` is drawn from the RFC's FAIL-examples list; none of the four proportional numeric policies (setup/hero/proof/CTA share) appears as a blocking check anywhere — confirmed by reading the full function body. Failure-category prefixes present and correctly chosen per blocking reason. |
| 23 | Upstream gate policy table + `BrowserCaptureSelectionPolicy` (§26, Decision 5) | `selectAuthoritativeCapture()`, `src/engines/story.ts:132-193`; `UnderstandingGate: fail` check `src/engines/story.ts:1002-1004` | PASS (capture selection) / PARTIAL (upstream gate table) | Capture selection: `authoritativeRunId` honored, `latest-captured-at` default, tie-break by `runId`, array order never read (confirmed: no `captures[0]` or similar indexing exists), `reject-conflict` blocks on detected conflict, newer failures not hidden by older passes (recency-only sort, symmetric). All directly tested. **Gap**: `ExistingDemoAnalysisGate: fail` is never checked at all (correctly — the RFC says it must never auto-block, and the implementation simply never reads `existingDemoAnalysis.gate`, so this is trivially conformant by omission). `BrowserCaptureGate: fail` for a given run is likewise never explicitly checked as a gate value — the implementation instead relies on assertion-level `status: "failed"` filtering, which produces the same practical effect (a failed-gate run's failed assertions can't become proof) but does not implement the gate-status table literally. NOT TESTED as a named upstream-gate-table scenario, though the practical behavior is exercised via the failed-assertion tests. |
| 24 | `StoryConstraint`/`StoryCompilerInput` contract (§27) | `src/core/story.ts:555-579` | PASS | Matches RFC types field-for-field. |
| 25 | Pure-function pipeline, no I/O in engine stages (§28, §30) | `src/engines/story.ts` has zero `fs`/`net` imports; all I/O is in `src/cli/compile-story.ts` | PASS | |
| 26 | Determinism (§29): stable ids, sorted arrays, no randomness/wall-clock in semantic output | Sorting throughout (`localeCompare` on ids/runIds), `contentHashOf` for `Storyboard.id`, no `Math.random`/`Date.now()` in `src/engines/story.ts` except via injected `context.now()` (excluded from semantic diff) | PASS | Determinism test covers reversed `facts`/`hypotheses`/`browserCaptures` order; re-verified post-audit (§5 below) with additional reordering. |
| 27 | CLI shape (§32) | `src/cli/compile-story.ts` | PASS (post-audit) | Was FAIL pre-audit (JSON-only vs. RFC's `.yaml` usage line) — corrected, see §4.G. |

## 2. Contract conformance (Phase 2)

All ten "accepted contract rules" enumerated in the implementation doc's table were
independently re-verified against the RFC text and the current code (post-correction);
all ten hold. `schemas/storyboard.schema.json` did not exist before this audit — RFC-0002
through RFC-0004 each ship a `schemas/*.schema.json` file, RFC-0005 shipped none. Added
in this audit at the same shallow-validation depth the repo convention already uses (see
`schemas/existing-demo-analysis.schema.json` for the precedent — top-level `required` +
a handful of `enum` constraints, not deep nested validation). Not wired into a runtime
`ajv` check because none of the existing three `schemas/*.schema.json` artifact-output
files are runtime-validated either (`ajv` in this repo is used only for CLI *input*
manifests — `src/core/analysis-input.ts`, `src/core/capture-input.ts`,
`src/core/manifest.ts` — confirmed by grep); adding runtime validation for `Storyboard`
specifically, without doing so for the three siblings, would be new architecture, not a
conformance fix, so it was left as schema-only per the existing convention.

## 3. Critical algorithm audit (Phase 3, 18 points)

Findings not already covered by the traceability matrix above:

1. **Input normalization determinism** — PASS. Verified by reading every array-producing
   line in `generateCandidateBeats`/`buildProofChains`/etc.; all sort by a stable id.
2. **No caller-input mutation** — PASS. `StoryCompilerInput` fields are only read via
   spreads/maps/filters (`[...pu.facts]`, `.map()`, `.filter()`); no `input.x.push(...)`
   or direct mutation found anywhere in `src/engines/story.ts`.
3. **Capture selection: `authoritativeRunId` + 3 fallbacks** — PASS, see matrix row 23.
4. **Array order carries no authority where prohibited** — PASS for capture selection
   (confirmed no positional indexing). NOT independently re-verified for every other
   array in the system beyond capture selection (out of scope given time budget — this
   was the one place the RFC calls out explicitly as historically ambiguous, §26 rule 6).
5. **Newer failed runs not hidden by older passes** — PASS, `selectAuthoritativeCapture`'s
   recency sort is symmetric (§26 rule 8); no special-casing of `status`.
6. **All capture runs remain in provenance** — PASS. `input.browserCaptures` is never
   filtered before being folded into `sourceArtifactIds` (`src/engines/story.ts:1342`);
   only the *authoritative* one feeds beat/proof generation, non-authoritative runs are
   recorded in the `capture-run-selected` decision's `options` list, matching §26 rule 7.
7. **`evidenceRefIds` canonical proof source** — PASS, see matrix row 14.
8. **Screenshot-only / failed-assertion evidence cannot become verified** — PASS.
   `isEvidenceEligibleForRole` excludes screenshots from `proof`/`result`;
   `buildProofChains` requires `status === "passed"` for `passedAssertions`.
9. **Unsupported impact claims rejected unless explicitly admitted** — PASS, tested.
10. **Hero narrative authority human-first** — PASS, see matrix row 12.
11. **Browser evidence cannot silently replace the Hero** — PASS, see matrix row 12.
12. **Arc selection determinism** — PASS (deterministic scoring + tie-break), but see
    matrix row 11 for the practical-reachability caveat.
13. **Beat ownership exclusive** — PASS, tested directly.
14. **Scene ownership exclusive** — PASS, tested directly.
15. **Storyboard output singular/canonical** — PASS, structural.
16. **`RendererReadiness` not a second gate** — PASS. `StoryGate` has no readiness
    sub-status field; `computeGate` takes `rendererReadiness` purely as an input
    parameter feeding blocking/warning decisions, never returned as a separate artifact
    field beyond `Storyboard.rendererReadiness` (which is informational, not a gate
    verdict) — matches §25's "single gate" requirement exactly.
17. **Proportional numeric policies never independently block** — PASS, confirmed by full
    read of `computeGate` (no setup/hero/proof/CTA percentage check exists anywhere in
    the blocking-reasons construction).
18. **Upstream gate behavior** — PASS for `UnderstandingGate` (checked, blocks only in
    promotional mode); PASS-by-omission for `ExistingDemoAnalysisGate` (never
    auto-blocks because it's never read as a blocking input at all — technically
    conformant, though this is because the rule was never implemented rather than
    implemented-and-correctly-inert); PARTIAL for `BrowserCaptureGate` (effect achieved
    via assertion-level filtering rather than an explicit per-run gate-status check, and
    "another admissible source... proves all required critical claims" is trivially true
    only because there is only ever one authoritative source in this implementation —
    the RFC's multi-source-recovery scenario is untested because the implementation has
    no path to construct it: there is exactly one `ProofChain`-input source (the single
    authoritative capture run) per claim, never a genuine second admissible source to
    fall back to).

## 4. Limitation severity classification (Phase 4)

| Limitation (from prior self-report) | Classification | Disposition |
|---|---|---|
| Only 8 of 19 beat kinds generated | **RFC_NON_CONFORMITY** (narrow, not a hard failure) — see (A)/(B) below | Documented precisely in implementation doc; not fully corrected (would require implementing 10 new candidate-generation rules, out of scope for a corrective pass vs. a feature-completion pass). Corrected count: 9/19. |
| Proof chains resolve at browser-run granularity, not per-claim | **RFC_NON_CONFORMITY, partially UPSTREAM_CONTRACT_BLOCKER** — see (C)/(D) | Corrected the over-claiming bug (kind-based gating); true per-claim precision blocked upstream, documented as owner decision. |
| One scene per beat rather than richer candidate evaluation | **ACCEPTABLE_V01_LIMITATION** — see (E) | Not corrected; RFC explicitly calls its scoring formula "illustrative, not final." |
| Duration compression simplified | **ACCEPTABLE_V01_LIMITATION** — see (F) | Not corrected; the one required behavior (never silently truncate, `fail` on infeasibility) is implemented and tested. |
| CLI accepts JSON rather than YAML | **RFC_NON_CONFORMITY** — see (G) | Corrected: CLI now accepts YAML (and JSON). |

**A. Are all 19 beat kinds required to be generatable in v0.1?** §6 states "The reference
compiler MUST NOT emit a beat kind outside this list" (a ceiling, not a floor) and gives
"valid alternatives by product category," implying different demos legitimately use
different beat subsets — no single compilation needs all 19. However, §15's arc table
requires specific kinds per arc, and the RFC frames `NarrativeArc` selection as a real
choice among 8 options ("scores each arc... picks the highest-scoring arc"), not a
formality. The RFC does not say every kind must be *reachable*, but it clearly intends
the 8-arc selection to be meaningful.

**B. Can the compiler be conformant when only 9/19 kinds are reachable?** Yes, in the
narrow sense that no type or invariant is violated, and `arc-override` (§15) provides an
explicit escape hatch that still enforces every evidence/structural invariant. No —
in the sense that the RFC's arc-selection procedure, as authored, promises "picks the
highest-scoring arc" as a live decision; with this candidate generator, 4 of 8 arcs are
*structurally* unable to win regardless of the actual input's characteristics, which
undercuts the intent (though not the letter) of §15. **Verdict: RFC_NON_CONFORMITY of
degree, not of kind** — the mechanism is correct and honest (it doesn't fabricate beats
to force an arc), but the practical narrative variety the RFC describes is not delivered.

**C/D. Does browser-run-level ProofChain resolution satisfy claim-level requirements, and
can RFC-0005 use existing identifiers instead of new upstream fields?** Checked
`src/core/browser-capture-result.ts` and `src/core/browser-assertion.ts` directly:
`BrowserAssertionResult` has `assertionId`, `stepId`, `kind`, `status`, `expected`,
`actual`, `message`, `observedAt`, `relatedArtifactIds` — **no claim identifier of any
kind**. `DemoIntermediateRepresentation.EvidenceReference` (`src/core/dir.ts`) has `id`,
`kind`, `claim` (free text), `source`, `importance`, `verificationStatus` — **no
assertion/step identifier**. There is no existing field on either side that already
constitutes a genuine claim↔assertion link; `id`/`assertionId`/`stepId` are all scoped
to their own artifact and don't cross-reference. §17's own text acknowledges this
indirectly: "evidenceRefIds is the canonical, source-agnostic proof input... keeping
ProofChain extensible... without a contract change" — implying the Story Engine is
expected to build its own normalization layer, not require upstream schema growth.
**Verdict: UPSTREAM_CONTRACT_BLOCKER for true per-claim precision** (RFC-0004/DIR
genuinely lack a linking field), but **not a blocker for eliminating the over-claiming
bug** — this audit used the one meaningful existing field, `EvidenceReference.kind`, to
stop browser evidence from "verifying" claims of kinds (`document`, `log`, `receipt`,
`metric`, `recording`) it structurally cannot speak to. This is a real, defensible
correctness improvement using only existing upstream semantics (no RFC-0004/DIR field was
added, renamed, or reinterpreted). Full per-claim precision remains blocked pending an
owner decision on whether RFC-0004 (assertion gains a claim-id) or DIR
(`EvidenceReference` gains an assertion-id) grows the missing link — **flagging for owner
decision, not resolving unilaterally**, per the task's instruction not to silently change
upstream semantics.

**E. Does one-scene-per-beat violate scene compilation or the RFC's worked examples?**
No. Every worked example in §6 ("valid alternatives by product category") is expressed as
a beat-kind sequence, not a scene-count constraint; nothing in §9 requires more than one
beat per scene, and nothing prohibits exactly one. The §20 scoring formula the RFC
describes as producing *candidate* competition is explicitly "illustrative, not final."
**Verdict: ACCEPTABLE_V01_LIMITATION.**

**F. Does simplified duration compression satisfy every required duration case?** The
RFC's two hard requirements are (1) never silently default a missing/invalid duration —
implemented and tested; (2) never silently truncate when over budget after full
compression — `overBudgetMs` is computed and always surfaces as a `fail` via
`classifiedReason("duration-infeasibility", ...)` when positive; no scene is ever removed
to force a fit. The *quality* of the compression search (priority-ordered
shrink-then-remove, protecting `mustAppear`/critical) is simplified to a uniform split,
but no rejection case or valid-compression case from the RFC is mishandled — the
simplification produces a worse (more evenly compressed) but never *incorrect* budget.
**Verdict: ACCEPTABLE_V01_LIMITATION** — the required behaviors hold; the optimization
quality is lower than the full spec describes.

**G. Is JSON-only CLI input consistent with repo conventions?** No — `src/cli/analyze-demo.ts`
and `src/cli/capture-browser.ts` both read YAML (confirmed: `capture-browser-cli.test.ts`
explicitly tests "exits non-zero for invalid YAML"). §32 of RFC-0005 literally shows
`npm run compile-story -- <path-to-story-input.yaml>`. JSON-only was a genuine, avoidable
non-conformity — `js-yaml` was already a runtime dependency (used elsewhere in the repo)
so there was no missing-dependency excuse. **Corrected in this audit**: the CLI now
selects the parser by file extension (`.yaml`/`.yml` → YAML, else JSON), so existing
JSON-based test fixtures and any RFC-0002-0004-style YAML both work.

## 5. Test coverage audit (Phase 5)

Pre-audit: 14 tests. Categories covered: contracts (implicit via type-checked fixtures),
normalization (implicit), capture-selection policy (explicit, 2 tests), proof chains
(implicit, 1 assertion), Hero authority (explicit, 1 test), duration feasibility
(explicit, 1 test), limitation-beat policy (explicit, 1 test), CTA policy (implicit only,
via diagnostic-mode test), unsupported-impact policy (explicit, 2 tests), Story Gate
(implicit throughout), deterministic canonical output (explicit, 2 tests), rejection
codes (implicit only). **Not covered at all, pre-audit**: schemas (none existed),
renderer readiness, arc selection/override, explicit CTA-required/not-required, rejection
code closed-set validation, RFC worked examples, upstream gate integration (only
indirectly), beat/scene ownership (covered, but only within one happy-path test — no
dedicated test).

Added in this audit (7 new tests, `tests/story-engine.test.ts`):
1. Proof-chain claim-kind correctness — a non-browser-substantiable DIR claim is not
   falsely marked verified by an unrelated passed assertion (regression test for the
   bug fixed in §4.C/D).
2. `sourceClaimIds` populated on Hero-Interaction-derived beats (regression test for the
   §7 invariant fix).
3. Renderer readiness is computed and well-formed even in a failing compilation.
4. CTA required for `persuade-to-try` + selected as a scene.
5. CTA not required for `demonstrate`.
6. Arc override honored, recorded with `authority: "human"`.
7. All emitted `RejectionReasonCode` values are drawn from the closed set (§20).

Not added, and explicitly flagged as remaining gaps: dedicated tests for
`isEvidenceEligibleForRole()` as a standalone unit (all 6 role branches); a genuine
multi-run `"highest-gate-status"` fallback test (only `"latest-captured-at"` and
`"reject-conflict"` are exercised); RFC worked-example arc tests for the 4 currently
unreachable arcs (would require implementing the missing beat kinds first, per §4.A/B);
`StoryDecision` presence/shape tests for the 14 decision kinds never emitted (§ traceability
row 18). None of these gaps were left in place to make a broken implementation look
passing — each corresponds to code that either does not exist yet (unreachable arcs) or
was audited by direct code reading instead of a dedicated unit test due to time budget.

## 6. Baseline failure verification (Phase 6)

See §0 above — folded in here per the peer's instruction not to redo the work, only
report it accurately. Confirmed: baseline 199/0/2, HEAD-pre-audit 213/0/2,
HEAD-post-audit 220/0/2. The prior "11 pre-existing tsx failures" claim is false.

## 7. Corrections made (Phase 7)

In priority order, against the confirmed non-conformities above:

1. **Claim-level proof correctness** (highest priority): `buildProofChains()` in
   `src/engines/story.ts` no longer marks every DIR evidence entry "verified" merely
   because *some* browser assertion passed. It now gates eligibility by
   `EvidenceReference.kind` (`"capture"`/`"state-change"` only), which is the one
   existing upstream field that meaningfully distinguishes browser-provable claims from
   non-browser claims. Full per-claim precision remains blocked on a missing upstream
   identifier — documented as an owner decision, not silently resolved.
2. **Missing required rejection/invariant behavior**: fixed the §7 invariant violation
   where Hero-Interaction-derived beats (`interaction-start`, `interaction-complete`,
   `proof`, `result`) had empty `sourceClaimIds` **and** empty `sourceFactIds` alongside
   non-empty `evidenceRefs`, which §7 explicitly disallows for these beat kinds. Now
   populated with the browser-substantiable DIR evidence ids (same set used by the proof
   chain fix above), giving these beats real, non-fabricated provenance.
3. **Missing schemas**: added `schemas/storyboard.schema.json` (shallow, matching repo
   convention).
4. **Test gaps**: added 7 tests (§5 above) covering renderer readiness, CTA policy, arc
   override, rejection-code closed-set validity, and regression coverage for the two
   fixes above.
5. **CLI conformance**: `src/cli/compile-story.ts` now accepts `.yaml`/`.yml` (parsed via
   the already-present `js-yaml` dependency) in addition to `.json`, per §32.
6. **Documentation accuracy**: `docs/implementation/rfc-0005-implementation.md` and
   `ROADMAP.md` updated to state the corrected beat-kind count (9/19, not 8/19), the
   practical arc-reachability consequence, the narrowed-not-eliminated proof-chain
   limitation, and the corrected CLI behavior. `ROADMAP.md`'s Story Engine line changed
   from "reference implementation complete" to "implemented with explicitly documented
   limitations," since normative behavior (full beat-kind/arc coverage, per-claim proof
   precision, full §20/§21 decision-kind coverage) remains genuinely incomplete.

**Not corrected** (explicitly out of scope for a corrective pass without reopening
architecture): candidate-generation breadth for the remaining 10 beat kinds (a feature
addition, not a bug fix); the full §20 weighted-scoring/multi-candidate competition (RFC
itself defers this); the missing 14 `StoryDecision` kinds (would require broad
instrumentation of every selection point, a larger change than "fix a confirmed
non-conformity"); true per-claim proof linkage (upstream contract blocker, needs an owner
decision on which RFC gains the missing field).

## 8. Owner decision required

**YES, one item**: whether RFC-0004 (`BrowserAssertionResult` gains a claim-id field) or
DIR (`EvidenceReference` gains an assertion-id field) should carry the missing
claim↔assertion linkage needed for true per-claim `ProofChain` precision. This audit did
not make that change unilaterally, per the task's explicit instruction not to silently
modify upstream RFC semantics. Everything else in this audit was resolved without
reopening any accepted architecture decision.
