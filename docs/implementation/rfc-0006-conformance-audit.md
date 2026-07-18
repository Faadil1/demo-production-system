# RFC-0006 conformance audit

Independent re-check of the implementation against
`docs/008-renderer-neutral-render-planning-and-technical-render-gate.md`, focused on the
§44 verification invariants (numbered 1-29 below, matching the RFC's own numbering) plus
the §4 non-goals. Each row cites the concrete source/test location checked, not merely
the implementation summary.

## §44 Verification invariants

| # | Invariant | Verdict | Evidence |
|---|---|---|---|
| 1 | Every pipeline result representable by `RenderFinding` | PASS | `src/engines/render.ts::mkFinding` is the only finding constructor used across all 14 stages; no ad hoc error shape is returned to the caller outside `RenderRejection.findings`/`RenderGateResult.blockingFindings`/`.warnings`. |
| 2 | `RenderConstraintFinding` used only for constraint-originated findings | PASS | No standalone `RenderConstraintFinding` value is ever constructed; constraint-stage findings (`layout`/`timing`/`capability-negotiation` stage + `source.kind: "constraint"`) are plain `RenderFinding`s that happen to satisfy the narrower subtype shape. The type is never used as the general finding type anywhere (`src/core/render.ts`, `src/engines/render.ts`). |
| 3 | Story Gate fail never enters | PASS | `src/engines/render.ts` lines ~230-243; `tests/render-engine.test.ts` "rejects when the Story Gate has status fail". |
| 4 | Conditional entry is renderer-bound | PASS (with documented policy limitation) | `classifyEntryRequirement()` (`src/engines/render.ts`); tested for both the not-renderer-bound-reject and renderer-bound-admit cases. Limitation: the classifier is a regex pattern policy over free-text `StoryGate.requirementsBeforeRender`, because RFC-0005 does not type these strings (documented in the implementation plan). |
| 5 | Storyboard hash and structure unchanged | PASS | Entry stage recomputes `canonicalHash(storyboard)` and compares to both `bundle.storyboardContentHash` and `input.expectedStoryboardContentHash` (triple check); `tests/render-engine.test.ts` "does not mutate the Storyboard input" asserts byte-identical `canonicalStringify` before/after `run()`. |
| 6 | Hero Interaction and ownership remain unchanged | PARTIAL | The engine never reads or writes `storyboard.heroInteraction`, and `RenderScene.storyboardSceneId`/`.order` are copied verbatim from `StoryScene`, so nothing in the compiler *can* alter Hero ownership. However, there is no dedicated test asserting Hero Interaction scene-id relationships survive compilation (only generic non-mutation is tested). |
| 7 | Output profiles are explicit | PASS | `resolveOutputProfile()` (`src/core/render-profile.ts`) only accepts `registered` (hash-verified) or `inline-custom` (fully specified) — there is no adapter-default branch. `tests/render-profile.test.ts`. |
| 8 | Frame arithmetic is exact | PASS | `src/core/rational.ts` uses `bigint` throughout; no `Number`/float arithmetic in `exactFrames`/`add`/`sub`/`mul`/`compare`. `tests/render-rational.test.ts`. |
| 9 | Quantization uses cumulative half-to-even | PASS | `src/core/frame-quantization.ts::quantizeScenes` implements the exact §13 pseudocode (cumulative ms → exact rational → `roundHalfToEven` per boundary). Golden fixtures in `tests/render-quantization.test.ts` (integral 30fps, fractional 30000/1001, lower/upper exact ties). |
| 10 | No residual frames redistributed | PASS | Each boundary is quantized independently from its own cumulative exact value — no post-hoc adjustment step exists in `quantizeScenes`. `tests/render-quantization.test.ts` "does not redistribute residual frames across many scenes". |
| 11 | Transition windows don't change scene boundaries or runtime | PASS | `RenderTransition` carries only metadata (`transitionWindowFrames`, capability id); scene `startFrame`/`endFrameExclusive` are set solely from the timing manifest, never adjusted for a transition. `tests/render-engine.test.ts` "keeps left.endFrameExclusive === right.startFrame". |
| 12 | No canonical timeline index belongs to two narrative scenes | PASS (by construction, narrow test coverage) | Guaranteed structurally by contiguous, non-overlapping `[startFrame, endFrameExclusive)` ranges emitted by `quantizeScenes` (invariant 10) — no code path ever widens a scene's range for a transition. Only directly tested on a 2-scene fixture; not fuzz-tested across many scenes/transitions. |
| 13 | Adapters cannot adjust timing | NOT APPLICABLE (no adapter exists yet) | The `RenderPlan` contract exposes no writable timing surface to a renderer adapter, and this repository ships no renderer adapter to attempt a violation against. This is a contract-level guarantee, not an integration-tested one. |
| 14 | Required asset selection is unique | PASS | `src/engines/render.ts` asset-resolution block: ties among distinct sources at the best preference rank produce `ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS` and reject for required bindings. `tests/render-engine.test.ts` "flags ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS". |
| 15 | Invalid assets never appear in `resolvedAssets` | PASS | A candidate only becomes a `ResolvedRenderAsset` after passing the `eligible` filter (media-type match + detected-vs-declared match); malformed candidates are excluded before the ranking step. `tests/render-engine.test.ts` "excludes a hash/format-mismatched candidate". |
| 16 | Optional unavailable assets are omitted and reported | PASS | Optional bindings with zero eligible candidates emit only `OPTIONAL_ASSET_UNAVAILABLE` and no layer/asset entry is created. `tests/render-engine.test.ts` "omits an optional unavailable asset and reaches conditional". |
| 17 | Prepared assets are valid and traceable | PARTIAL | `preparationRequirementIds`/`preparedArtifactId`/`preparedContentHash` are always populated and traceable, but the preparation step is a documented deterministic **mock pass-through** (no real pixel/video transform), so "valid" here means "structurally well-formed," not "genuinely transformed and re-validated." See Known Limitations in `rfc-0006-implementation.md`. |
| 18 | Text variant priority precedes lexical ID | PASS | Variant ordering sort key is `(authoritativePriority, id)` in that order (`src/engines/render.ts` text-layer block). `tests/render-engine.test.ts` "prefers a lower-priority-number variant over a lexically earlier ... variant" (variant-z priority 1 beats variant-a priority 2 despite lexical order). |
| 19 | Text is never rewritten, summarized, or truncated | PASS | The compiler only ever assigns `resolvedText` to the original authorized text or a full approved-variant's `text` field verbatim; no substring/truncation/ellipsis logic exists anywhere in the text-layer block. `tests/render-engine.test.ts` "emits TEXT_OVERFLOW ... and never truncates". |
| 20 | Unsupported required capabilities fail | PASS | Every capability-negotiation check (`src/engines/render.ts`) emits a `critical` finding on mismatch, which always routes to `blocking` in gate aggregation regardless of override state. `tests/render-engine.test.ts` Case B tests + golden adapter-snapshot fixture. |
| 21 | Critical findings are never overridden | PASS | Gate aggregation pushes `criticality === "critical"` findings straight to `blocking` before any override lookup; a caller-supplied override targeting a critical finding is itself flagged `OVERRIDE_INVALID`. `tests/render-engine.test.ts` "never overrides a critical finding". |
| 22 | Conditional plans remain executable | PARTIAL | There is no separate "executability" predicate distinct from "zero blocking findings" — the RFC's own §33 pseudocode note ("require plan is technically executable") is treated as implied by the absence of any critical/blocking finding, not verified by an independent executability check. |
| 23 | Gate requirements are typed | PASS | `RenderRequirement.allowedNextAction` is the closed `RenderAllowedNextAction` union; `requirementFor()` derives it from a total lookup table (`NEXT_ACTION_FOR_REASON`) keyed by every `RenderGateReasonCode`. |
| 24 | Case A/B/C emissions follow §40 | PASS | `src/cli/compile-render.ts` branches on `result.kind`; Case A writes only `render-rejection`; Cases B/C always write `resolved-assets` + `render-plan` + `render-gate`. `tests/compile-render-cli.test.ts` covers all three cases end to end via the real CLI subprocess. |
| 25 | Gate-failed canonical plans remain persisted | PASS | Case B path in `compile-render.ts` is identical to Case C except gate status; `tests/compile-render-cli.test.ts` "Case B" asserts `render-plan.json` exists with exit code 1. |
| 26 | Post-render codes cannot appear in Render Gate artifacts | PASS | `PostRenderReasonCode` is a wholly separate closed TypeScript union from `RenderGateReasonCode`; `RenderGateResult`/`RenderFinding` are typed against `RenderGateReasonCode` only, so a post-render code cannot type-check into a gate artifact. Verified by inspection of `src/core/render.ts`; not runtime-tested (would be a compile error, not a runtime path). |
| 27 | Core contracts remain adapter-neutral | PASS | `grep -rn "Remotion" src/core/render.ts src/engines/render.ts` matches only a documentation comment explaining the neutrality rule itself — no Remotion (or any other adapter-specific) type/import exists. |
| 28 | Existing artifact conventions are reused | PASS | `src/cli/compile-render.ts` uses `buildArtifactEnvelope`/`FilesystemArtifactRegistry`/`DecisionLog`/`EventLog` from RFC-0001-0005, identically to `compile-story.ts`; no second registry/envelope type is defined. |
| 29 | Equivalent inputs produce identical canonical bytes | PASS | `tests/render-engine.test.ts` "produces byte-identical canonical plan bytes for equivalent inputs" asserts `canonicalHash(r1.plan) === canonicalHash(r2.plan)` across two separate `run()` calls with identical input. |

## §4 Non-goals spot-check

| Non-goal | Verdict | Evidence |
|---|---|---|
| Does not mutate the canonical Storyboard | PASS | See invariant 5/6. |
| Does not introduce Remotion-specific core contracts | PASS | See invariant 27. |
| Does not compile an adapter-specific composition | PASS | `RenderPlan`/`RenderScene`/`RenderLayer` contain only renderer-neutral geometry/timing/asset-id fields — no Remotion `<Sequence>`/`<AbsoluteFill>` or similar structures. |
| Does not render frames, encode/mux/export MP4 | PASS | No frame/pixel-buffer/video-encoding code exists anywhere in `src/core/render*.ts` or `src/engines/render.ts`; `PostRenderValidationRequest` is defined but never invoked. |
| Does not run pixel/decoded-video/codec/container checks | PASS | Asset integrity uses hash + magic-byte header sniffing only (`src/core/render-media.ts`), never pixel or decoded-frame inspection. |
| Does not create a competing artifact registry | PASS | See invariant 28. |
| Does not rewrite/summarize/truncate text | PASS | See invariant 19. |
| Does not call external AI services | PASS | No network/AI-service calls anywhere in the RFC-0006 source files. |

## Conformance summary

- **PASS: 24 / 29** numbered invariants (1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18,
  19, 20, 21, 23, 24, 25, 26, 27, 28, 29), plus all 8 spot-checked §4 non-goals.
- **PARTIAL: 4 / 29** (4, 6, 17, 22) — each is a documented, narrow scope limitation, not
  a contract violation: entry-requirement classification is a versioned pattern policy
  over untyped upstream strings (4); Hero-preservation is guaranteed by non-interference
  but not independently test-asserted (6); asset preparation is an honest mock (17); gate
  "executability" is implied by, rather than independently verified from, the absence of
  blocking findings (22).
- **NOT APPLICABLE: 1 / 29** (13) — no renderer adapter exists in this repository to
  test against; the contract itself grants adapters no timing-mutation surface.
- **FAIL: 0 / 29.**
- **NOT TESTED (beyond the PARTIAL notes above): none identified.**

No FAIL verdicts were found. The four PARTIAL items and the one NOT APPLICABLE item are
all already called out in `rfc-0006-implementation.md`'s Known Limitations and do not
require an owner decision — they are the documented, narrow-but-honest v0.1 boundary the
mission brief explicitly permits ("narrowest honest interface + reference/mock adapter").
