# RFC-0002 — Product Understanding Contract

## Status

Accepted for implementation.

## Goal

Strengthen the Understanding Engine so it produces a structured, inspectable Product
Understanding artifact that clearly separates observed facts, user-supplied claims,
inferred hypotheses, available evidence, missing evidence, Hero Interaction candidates,
risks and ambiguities, confidence, and human approval requirements — without adding
browser automation, an LLM, Remotion, network access, or any probabilistic behavior.
Everything in this RFC is deterministic: identical manifest input always produces
identical Product Understanding, Plan, and DIR payloads (excluding run identifiers and
timestamps).

## Scope

1. Replace the loose `Understanding` payload (RFC-0001) with an explicit
   `ProductUnderstanding` contract (`schemaVersion: "0.2"`), defined in
   `src/core/product-understanding.ts`.
2. Enforce provenance rules on every fact, claim, hypothesis, evidence item, and Hero
   Interaction candidate.
3. Generate Hero Interaction candidates without ever silently confirming a manifest hint
   as proven truth, and apply an explicit, auditable selection policy.
4. Compute deterministic evidence coverage and report insufficiency explicitly.
5. Introduce a structured Understanding Gate (`pass` / `conditional` / `fail`) that
   Rendering must respect.
6. Update the Planning Engine to consume the new contract, reject a failed gate, and
   preserve unresolved requirements rather than dropping them.
7. Update DIR compilation to preserve verification status per evidence item and expose
   an explicit `readiness` state (`ready` / `conditional` / `blocked`).
8. Bump artifact schema versions where contracts changed (Understanding, Plan, DIR all
   move to `"0.2"`); the `ArtifactEnvelope` contract itself is unchanged.

## Fact vs. claim vs. hypothesis vs. evidence

These four categories are the core of RFC-0002 and must never be confused with one
another (Constitution Law VIII: "A claim without observable support is a hypothesis").

| Category | Definition | Who "said" it | Verification |
|---|---|---|---|
| **Fact** | An objective, mechanically-read declaration about the manifest itself (e.g. "demo.mode is declared as 'directed'"). No interpretation is involved — the manifest file *is* the verifiable source. | The manifest, read directly | Always `verified` |
| **Claim** | A subjective, human-authored assertion about the product or the world (e.g. the problem statement, the value proposition, the Hero Interaction hint). The manifest author asserts it, but nobody has independently observed it. | A human, via the manifest | Always `unverified` in this RFC (no `confidence` above 0.6) |
| **Hypothesis** | An engine-inferred possibility that has not been asserted by anyone and requires explicit validation before it can be trusted (e.g. "the value proposition may indicate an unstated Hero Interaction" when no hint was given). | The engine, by inference | `validationRequired: true`, low confidence (0.3) |
| **Evidence (candidate)** | A hint from `product.evidenceHints` that *could* support a claim once verified. It is a candidate, not proof. | The manifest | Always `unverified` in this RFC |

The reference Understanding Engine only produces `sourceType: "manifest"` and
`sourceType: "inference"` items — `repository`, `documentation`, `capture`, `runtime`,
and `human` sources are defined in the type system for future engines (capture
adapters, human-in-the-loop review) but are out of scope here.

## Provenance rules

- Manifest values become **facts** only when they are structural declarations read
  without interpretation (project name, demo goal, demo mode, audience count). They
  become **claims** when they assert something about the product or the world (problem,
  value proposition, Hero Interaction hint).
- Inferences (`sourceType: "inference"`) are never represented as facts; they surface
  only as `hypotheses`, always with `validationRequired: true`.
- Evidence hints are evidence *candidates*. They are never marked `verified` by this
  engine — only a future capture-based engine can produce a `verified` or
  `partially-verified` status.
- `verificationStatus` is one of `unverified`, `partially-verified`, `verified`,
  `contradicted`. No item may be marked `verified` without a corresponding verifiable
  source (for this RFC, that source does not exist yet, so nothing is ever `verified`).
- All `confidence` values are clamped to `[0, 1]` (`clamp01` in `src/core/provenance.ts`)
  and are derived by fixed, documented arithmetic — never randomness or an external
  model.

## Hero Interaction candidate contract and selection policy

A Hero Interaction candidate is generated **only** when `product.heroInteractionHint`
is present in the manifest. Each candidate records what action occurs (`description`),
what value it demonstrates (`valueDemonstrated`), what evidence would prove it
(`evidenceIds`), what could make it weak (`risks`), and its provenance (`source`).

Selection policy (`UnderstandingEngine.run`):

- If exactly one candidate exists from an explicit manifest hint **and** it has at
  least one supporting evidence id, it is selected provisionally
  (`selectedHeroInteraction.authority: "manifest-policy"`).
- A candidate with **zero** supporting evidence requirements is never selected — Design
  Law 1 requires an addressable Hero Interaction, but Constitution Law VIII forbids
  treating an unsupported claim as confirmed. In that case `selectedHeroInteraction` is
  `null`, an `ambiguity` is recorded, and the Understanding Gate fails.
- `requiresHumanApproval` is `true` whenever `demo.mode` is `"assisted"` or
  `"directed"`, and `false` when `"autonomous"`.
- In `"autonomous"` mode, selection still proceeds without requiring human approval, but
  the candidate remains provisional: because the reference engine never verifies
  evidence, the Understanding Gate can still only reach `conditional`, never `pass`
  (see below).
- If no `heroInteractionHint` is present, the engine does **not** fabricate a candidate
  from the value proposition. Instead it records a low-confidence `hypothesis`
  (`validationRequired: true`), a critical `ambiguity`, and the gate fails. This is a
  deliberate change from RFC-0001, which silently treated the value proposition as a
  fallback Hero Interaction claim — that behavior violated Law VIII and has been
  removed.

## Evidence coverage

`evidenceCoverage` reports, deterministically:

- `requiredCount` — `constraints.minimumEvidenceCount` (default `1`).
- `availableCount` — number of evidence candidates derived from `evidenceHints`.
- `verifiedCount` — number of evidence items with `verificationStatus: "verified"`
  (always `0` in this RFC; no capture adapter exists yet).
- `criticalCount` — number of evidence items marked `importance: "critical"`.
- `coverageRatio` — `min(1, availableCount / requiredCount)`.
- `sufficient` — `availableCount >= requiredCount`.

Evidence hints are never counted as verified. When `sufficient` is `true` (quantity met)
but `verifiedCount` is `0` (nothing proven), the gate still cannot `pass` — coverage
*sufficiency* (having enough candidates) and coverage *verification* (having proven
them) are tracked and reported separately. A `missingEvidence` entry is recorded for
every unverified evidence item ("proof is still absent"), plus one additional
shortfall entry when `availableCount < requiredCount`.

## The Understanding Gate

```text
gate:
  name: "understanding"
  status: pass | conditional | fail
  blockingReasons: string[]
  warnings: string[]
  requirementsBeforeRender: string[]
```

Deterministic policy (`computeUnderstandingGate` in `src/engines/understanding.ts`):

- **FAIL** when any of: product identity is incomplete (missing problem, value
  proposition, or target audience), no Hero Interaction could be selected, evidence
  candidates don't meet `minimumEvidenceCount`, or an unresolved critical ambiguity
  exists.
- Otherwise, **CONDITIONAL** when evidence is not yet verified (`verifiedCount <
  requiredCount`) or human approval is still required.
- **PASS** only when structurally sound *and* evidence is verified *and* no human
  approval is outstanding.

Because the reference Understanding Engine has no capture adapter, `verifiedCount` is
always `0`. Consequently **PASS is unreachable by this deterministic reference engine
for any manifest that declares evidence requirements** — it will always resolve to
`CONDITIONAL` (structurally sound) or `FAIL` (structurally incomplete). This is
intentional: PASS is reserved for a future engine that can actually verify evidence
(e.g. via a capture adapter), and the current implementation must not claim more
certainty than it has earned.

For the shipped `examples/minimal/demo.yaml` (TrustCheck): problem, value proposition,
audience, and Hero Interaction hint are all present; evidence hints (3) meet
`minimumEvidenceCount` (3); but none are verified, and `demo.mode: directed` requires
human approval. Result: **CONDITIONAL**, not PASS, exactly as specified by this RFC.

Rendering must never begin from a FAIL state. This is enforced at two independent
layers: `PlanningEngine.validate()` rejects a FAILed gate before planning begins, and
`compileDIR()` independently refuses to compile (and `assertDIRInvariants` refuses to
accept) a DIR whose `readiness` would be `"blocked"`.

## Planning Engine integration

`Plan` (`schemaVersion: "0.2"`) now carries:

- `understandingGateStatus` — copied from `understanding.gate.status`.
- `unresolvedRequirements` — the union of `gate.requirementsBeforeRender`, unresolved
  `ambiguities`, and `missingEvidence`, deduplicated. Nothing is silently dropped.
- `selectedHeroInteractionId` — resolved from `understanding.selectedHeroInteraction`.
- `requiredEvidenceIds` — the selected candidate's `evidenceIds`.
- `humanApprovalRequired` — copied from the selected candidate.

`PlanningEngine.validate()` rejects the input outright when `gate.status === "fail"`,
when no Hero Interaction was selected, or when `selectedHeroInteraction.candidateId`
does not resolve against `heroInteractionCandidates`.

## DIR integration

`DemoIntermediateRepresentation` (`schemaVersion: "0.2"`) now carries a `readiness`
field (`ready | conditional | blocked`) derived from `plan.understandingGateStatus`, and
each `EvidenceReference` carries `verificationStatus` instead of a boolean `verified`
flag — unverified evidence is never represented as proven. `compileDIR()` throws before
producing a DIR if the incoming plan reports a failed gate, and `assertDIRInvariants()`
independently refuses a `"blocked"` DIR.

## Human approval behavior

`approvalRequirements` records one blocking entry (`status: "pending"`) whenever the
selected Hero Interaction's `requiresHumanApproval` is `true`. This mirrors Constitution
Law VII (human authority at declared approval gates): the system may select and plan
provisionally, but rendering in `assisted`/`directed` mode cannot proceed until a human
satisfies (or waives) that requirement.

## Current limitations

- No capture, repository, documentation, or runtime adapter exists yet, so
  `verificationStatus` can never move past `unverified` and the gate can never reach
  `pass`. This is intentional scope for a later RFC.
- Evidence-to-claim mapping (`supportsClaimIds`) is coarse: all evidence hints are
  associated with the single Hero Interaction claim (or the value-proposition claim as
  fallback), not with individually reasoned sub-claims.
- Ambiguity and risk detection is limited to the structural gaps this RFC specifies
  (missing hint, zero-evidence candidate, insufficient evidence count); it does not
  attempt open-ended risk analysis.
- `heroInteractionCandidates` will always contain at most one entry in this reference
  engine, since only one source (`product.heroInteractionHint`) is consulted.
