# RFC-0006 implementation

Status: reference implementation complete for the v0.1 scope described below, with
explicitly documented limitations (no real media transform/decoding, no adapter/renderer).

Source: `docs/008-renderer-neutral-render-planning-and-technical-render-gate.md`.
Plan: `docs/implementation/rfc-0006-implementation-plan.md`.
Independent audit: `docs/implementation/rfc-0006-conformance-audit.md`.

## Architecture

```
Storyboard (RFC-0005, immutable)
  -> entry eligibility               (RenderEngine.run, §8)
  -> output-profile resolution       (src/core/render-profile.ts, §11)
  -> asset binding/resolution/integrity (src/engines/render.ts, src/core/render-media.ts, §15-18)
  -> mechanical preparation (mock)   (src/engines/render.ts, §19)
  -> scene/layer compilation         (src/engines/render.ts, §20-24)
  -> frame quantization              (src/core/frame-quantization.ts, §13)
  -> transition mapping/validation   (src/engines/render.ts, §14/§25)
  -> objective layout constraints    (src/engines/render.ts, §31)
  -> capability negotiation          (src/engines/render.ts, §29-30)
  -> non-critical override evaluation(src/engines/render.ts, §35)
  -> one Render Gate                 (src/engines/render.ts, §32-34)
  -> artifact emission Case A/B/C    (src/cli/compile-render.ts, §40)
```

`RenderEngine` (`src/engines/render.ts`) is a single pure function
(`Engine<RenderCompilerBundle, RenderCompilationResult>`); every stage above runs inside
one `run()` call and produces `RenderFinding`s that are aggregated once at the end.

## Source map

- `src/core/render.ts` — every RFC-0006 contract (§10-43, Appendix A/D): closed unions,
  readonly fields, no adapter-specific (Remotion) types.
- `src/core/rational.ts` — exact BigInt rational arithmetic + half-to-even rounding (§12).
- `src/core/frame-quantization.ts` — cumulative-half-even boundary quantization (§13).
- `src/core/render-canonical.ts` — Unicode code-point comparison, canonical
  stringify/hash, deterministic ID derivation, layer sort key (§24/§37).
- `src/core/render-profile.ts` — output-profile resolution + the registered
  `dps-landscape-1080p30` reference profile (Appendix D).
- `src/core/render-media.ts` — magic-byte media-type detection (§18).
- `src/core/render-input.ts` — the `RenderCompilerBundle` pure-function input shape.
- `src/engines/render.ts` — the full pipeline.
- `src/cli/compile-render.ts` — `npm run compile-render -- <path>` (§42).

## Schemas

`schemas/render-compiler-input.schema.json`, `render-output-profile.schema.json`,
`adapter-capabilities.schema.json`, `render-finding.schema.json`, `render-gate.schema.json`,
`render-rejection.schema.json`, `render-plan.schema.json`, `resolved-render-assets.schema.json`,
`render-override.schema.json`, `post-render-validation-request.schema.json`.

## CLI usage

```sh
npm run compile-render -- <path-to-render-input.json>
```

Input file: a `RenderCompilerBundle` (see `src/core/render-input.ts`) as JSON or YAML —
`RenderCompilerInput` plus the Storyboard payload, `AdapterCapabilities` payload, asset
candidate records (with base64 bytes), binding/text-layer requests, and overrides. The
CLI recomputes `storyboardContentHash`/`adapterCapabilitiesHash` from the supplied
payloads itself (never trusts a hash in the file). Exit codes: `0` for a canonical plan
with `pass`/`conditional`; `1` for rejection, gate `fail`, invalid input, or an exception
(Case B still writes `render-plan.json` on exit `1`). The CLI never invokes adapter
compilation, rendering, export, or post-render validation.

## Deterministic guarantees

- All duration→frame math uses exact BigInt rationals (`src/core/rational.ts`); no
  floating-point value is authoritative.
- Cumulative-half-even quantization never redistributes residual frames or
  independently re-quantizes a scene (`src/core/frame-quantization.ts`, golden fixtures
  in `tests/render-quantization.test.ts`).
- All ID/key comparisons use Unicode code-point ordering
  (`src/core/render-canonical.ts::codePointCompare`), not `localeCompare`.
- Every ID (findings, requirements, resolved assets, scenes, transitions, plans) is
  derived via `deterministicId()` — a SHA-256 hash of canonically-serialized stable
  inputs — never `Math.random()`/`crypto.randomUUID()`.
- `tests/render-engine.test.ts`'s "determinism" block asserts byte-identical
  `canonicalHash(plan)` across repeated runs of equivalent input, and that the Storyboard
  input object is not mutated.
- Asset candidate selection ranks by `policyPreferenceRank`/content-hash/id — never by
  supplied array order — verified by a forward/reversed-declaration-order test.

## Supported policies (v0.1)

- Quantization: `cumulative-half-even` v0.1 (the only policy the RFC defines).
- Transition realization: `minimal-transition-policy` v0.1 — maps every RFC-0005
  `StoryTransitionIntent` to a closed `RenderTransitionKind`
  (`src/engines/render.ts::TRANSITION_INTENT_MAP`), with a deterministic window of
  `min(10, floor(min(leftDuration, rightDuration)/4))` frames (Appendix E minimal
  policy — a fixed, documented default, not a rich transition library).
- Layout: `minimal-layout-policy` v0.1 — bounds, safe-area, minimum-size (8x8px floor),
  non-overlap (for required layers), text-fit (Appendix E minimal layout policy).
- Entry classification: an internal versioned closed pattern policy over
  `StoryGate.requirementsBeforeRender` text (§8) — see Known Limitations.

## Reason codes implemented

All 45 `RenderGateReasonCode` values from §36 are declared in `src/core/render.ts`'s
closed union and mapped to a `RenderAllowedNextAction`
(`src/engines/render.ts::NEXT_ACTION_FOR_REASON`). The engine actively produces:
`STORY_GATE_INELIGIBLE`, `STORY_GATE_REQUIREMENT_NOT_RENDERER_BOUND`,
`STORYBOARD_HASH_MISMATCH`, `STORYBOARD_REFERENCE_INVALID`,
`OUTPUT_PROFILE_NOT_FOUND`/`_HASH_MISMATCH`/`_INVALID`/`_CONTRADICTORY`,
`ASSET_MISSING`, `ASSET_BINDING_UNRESOLVED`, `ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS`,
`ASSET_CORRUPT`, `ASSET_FORMAT_UNSUPPORTED`, `OPTIONAL_ASSET_UNAVAILABLE`,
`TIMING_ALLOCATION_IMPOSSIBLE`, `TRANSITION_OVERLAP_INVALID`, `TEXT_OVERFLOW`,
`CONTENT_OUT_OF_FRAME`, `SAFE_AREA_VIOLATION`, `MINIMUM_SIZE_VIOLATION`,
`REQUIRED_ELEMENTS_OVERLAP`, `ADAPTER_LAYER_UNSUPPORTED`, `ADAPTER_MEDIA_TYPE_UNSUPPORTED`,
`ADAPTER_TRANSITION_UNSUPPORTED`, `ADAPTER_DIMENSIONS_UNSUPPORTED`,
`ADAPTER_TIMEBASE_UNSUPPORTED`, `ADAPTER_COLOR_SPACE_UNSUPPORTED`,
`ADAPTER_AUDIO_MODE_UNSUPPORTED`, `ADAPTER_SCENE_UNSUPPORTED`, `OVERRIDE_INVALID`,
`OVERRIDE_NOT_ALLOWLISTED`. The remaining codes (e.g. `REQUIRED_AUXILIARY_TRACK_MISSING`,
`ASSET_PREPARATION_FAILED`, `RESERVED_REGION_MISSING`, `ADAPTER_TYPOGRAPHY_UNSUPPORTED`,
`ADAPTER_CAPABILITIES_*`) are declared and typed but not actively triggerable by this
reference compiler's scope (see Known Limitations — no auxiliary-track pipeline, no
failing mock preparation, no reserved-region auto-generation, no typography-feature
tracking, no adapter-capabilities artifact-hash re-verification path exercised in tests).

## Known limitations (honest boundary)

1. **Asset preparation is a deterministic mock pass-through.** No real image/video
   transform library is wired in; `preparedContentHash` currently equals
   `sourceContentHash`. This is the "narrowest honest interface + reference/mock
   adapter" the mission explicitly allows for — a real preparation service is future
   work, not implemented here.
2. **Media-type detection is magic-byte sniffing only**, not full codec/container
   decoding — dimensions/duration for video/audio are taken from caller-declared
   metadata, never independently derived from bytes.
3. **Text measurement is a synthetic deterministic model** (constant-width-factor ×
   character count), not real font-glyph metrics. It is deterministic and testable, but
   not visually accurate.
4. **Binding derivation is caller-declared**, not auto-derived from Storyboard semantic
   presentation intent — see the implementation plan's Scope Decisions.
5. **Auxiliary-track resolution, reserved-region auto-generation, and typography-feature
   negotiation** are typed in the contracts/reason-code registry but have no active
   pipeline logic in this reference compiler (no auxiliary track ever "exists" in this
   compiler's scope beyond being listed on the input).
6. **`RenderCompilerInput`'s artifact-id references are not resolved against the
   filesystem registry** by the CLI; the caller supplies the referenced payloads inline
   in the bundle file (documented in the implementation plan). Registry-based resolution
   is future CLI work.
7. **No Remotion adapter, no rendering, no MP4 export, no post-render validator
   execution** — all explicitly out of scope per RFC-0006 §4 and the mission brief.
   `PostRenderValidationRequest`/`PostRenderReasonCode` are defined but never executed.

## Deferred items (per RFC §48, mission brief)

Voice/caption generation, audio mixing, MP4 export, post-render validator execution,
perceptual critique, AI-assisted asset selection/cropping, responsive layout families,
distributed rendering/caching, advanced color workflows, rich transition libraries,
Remotion or any other renderer adapter.
