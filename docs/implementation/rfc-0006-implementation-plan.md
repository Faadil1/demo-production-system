# RFC-0006 implementation plan

This is the Phase 1 repository-inspection output for the RFC-0006 (Renderer-Neutral
Render Planning & Technical Render Gate) implementation. It records the conventions
observed before writing code and maps every normative section to its planned
source/schema/test/artifact location.

## Conventions reused from RFC-0002–0005

Same conventions RFC-0005's plan documents (`docs/implementation/rfc-0005-implementation-plan.md`)
apply unchanged: `src/core/<name>.ts` plain `readonly` contracts, `src/engines/<name>.ts`
implementing `Engine<I, O>`, `ArtifactEnvelope`/`FilesystemArtifactRegistry` reuse,
`DecisionLog`/`EventLog`, shared `determineExitCode()`, and `vitest` fixture-builder tests.

One deliberate deviation: RFC-0006 §37/§24 requires **Unicode code-point** ordering and
explicitly forbids locale-sensitive comparison, whereas RFC-0005's `stable-json.ts` uses
`localeCompare`. Rather than change RFC-0005's established (and out-of-scope) hashing
convention, RFC-0006 introduces its own canonical serializer (`src/core/render-canonical.ts`)
used only for RFC-0006 payloads.

## Input-bundle convention

`RenderCompilerInput` (§10) references upstream artifacts (Storyboard, `AdapterCapabilities`,
overrides, auxiliary tracks) by artifact id and content hash — it does not embed their
payloads. Per the same convention `compile-story.ts` documents for `StoryCompilerInput`
("in practice assembles those artifact payloads directly rather than describing raw
source data"), the pure `RenderEngine.run()` compiler takes a `RenderCompilerBundle`
(`src/core/render-input.ts`) that carries the referenced payloads inline, so the engine
stays a pure function over plain data with no registry I/O of its own. The CLI
(`src/cli/compile-render.ts`) recomputes `storyboardContentHash`/`adapterCapabilitiesHash`
from the supplied payloads itself — it never trusts a hash value from the input file —
which is what makes `STORYBOARD_HASH_MISMATCH` actually reachable end-to-end. Resolving
`RenderCompilerInput`'s artifact-id references against the filesystem registry (rather
than requiring the caller to inline payloads) is left as CLI follow-up work (see Known
Limitations in `rfc-0006-implementation.md`).

## Section → artifact map

| RFC-0006 section | Source | Schema | Tests |
|---|---|---|---|
| §10 RenderCompilerInput | `src/core/render.ts`, `src/core/render-input.ts` | `schemas/render-compiler-input.schema.json` | `render-schemas.test.ts`, `render-engine.test.ts` |
| §11 Output profile | `src/core/render-profile.ts` | `schemas/render-output-profile.schema.json` | `render-profile.test.ts` |
| §12 Rational timebase | `src/core/rational.ts` | — | `render-rational.test.ts` |
| §13 Cumulative quantization | `src/core/frame-quantization.ts` | — | `render-quantization.test.ts` |
| §14 Transition windows | `src/engines/render.ts` (transition mapping) | embedded in `render-plan.schema.json` | `render-engine.test.ts` (transitions describe block) |
| §15-18 Asset binding/resolution/integrity | `src/engines/render.ts`, `src/core/render-media.ts` | `resolved-render-assets.schema.json` | `render-engine.test.ts` (asset integrity/selection blocks) |
| §19 Preparation boundary | `src/engines/render.ts` (mock reference adapter) | embedded in `render-plan.schema.json` | `render-engine.test.ts` |
| §20-24 RenderPlan/Scene/Layer/geometry/ordering | `src/core/render.ts`, `src/engines/render.ts` | `schemas/render-plan.schema.json` | `render-engine.test.ts`, `render-schemas.test.ts` |
| §25 Transition realization policy | `src/engines/render.ts` (`TRANSITION_INTENT_MAP`) | — | `render-engine.test.ts` |
| §26-27 Text/typography/variants | `src/engines/render.ts` (deterministic measurement model) | — | `render-engine.test.ts` (text-fit block) |
| §29-30 AdapterCapabilities/negotiation | `src/core/render.ts`, `src/engines/render.ts` | `schemas/adapter-capabilities.schema.json` | `render-engine.test.ts` (Case B / golden fixture) |
| §31 RenderConstraint | `src/core/render.ts`, `src/engines/render.ts` | embedded in `render-plan.schema.json` | `render-engine.test.ts` (layout block) |
| §32-34 RenderFinding/Gate/criticality | `src/core/render.ts`, `src/engines/render.ts` | `schemas/render-finding.schema.json`, `schemas/render-gate.schema.json` | all `render-engine.test.ts` blocks |
| §35 Overrides | `src/core/render.ts`, `src/engines/render.ts` | `schemas/render-override.schema.json` | `render-engine.test.ts` (overrides block) |
| §36 Reason codes | `src/core/render.ts` | referenced throughout | all render tests |
| §37-39 Determinism/immutability/provenance | `src/core/render-canonical.ts`, `src/engines/render.ts` | — | `render-engine.test.ts` (determinism block) |
| §40 Artifact emission (Case A/B/C) | `src/cli/compile-render.ts`, `src/engines/render.ts` | `render-rejection.schema.json`, `render-plan.schema.json`, `render-gate.schema.json` | `compile-render-cli.test.ts`, `render-engine.test.ts` |
| §42 CLI/exit codes | `src/cli/compile-render.ts` | — | `compile-render-cli.test.ts` |
| §43 Post-render boundary | `src/core/render.ts` (`PostRenderValidationRequest`, `PostRenderReasonCode` — defined, never executed) | `schemas/post-render-validation-request.schema.json` | `render-schemas.test.ts` |
| Appendix D reference profile | `src/core/render.ts` (`DPS_LANDSCAPE_1080P30_V01`) | `schemas/render-output-profile.schema.json` | `render-profile.test.ts` |

## Scope decisions (documented, not silent)

1. **Binding derivation is caller-declared, not auto-derived from Storyboard semantic
   intent.** The RFC leaves "map Storyboard presentation intent to concrete layers"
   underspecified in exact algorithmic terms; the reference compiler accepts explicit
   `RenderBindingRequest`/`RenderTextLayerRequest` declarations (which scene, which
   evidence, which geometry) and performs every RFC-normative validation/selection/
   integrity/timing/layout/capability step over them deterministically. This mirrors how
   RFC-0005's own "illustrative, not final" scoring formula was narrowed to a documented,
   testable subset.
2. **Asset-preparation is a deterministic mock pass-through**, not a real pixel/video
   transform. No dependency for real image/video decoding exists in this repository; the
   preparation boundary (interface, requirement records, provenance fields) is fully
   implemented and honest about non-functionality — see Known Limitations.
3. **Media-type detection is honest magic-byte sniffing** for the closed v0.1
   `RenderMediaType` union (PNG/JPEG/WebP/MP4/WebM/WAV/MP3/TTF/WOFF2 signatures), not full
   codec/container decoding (explicitly out of scope per §4).
4. **Text measurement uses a deterministic synthetic model** (character-count ×
   font-size × constant width factor), not real font-file glyph metrics — documented as
   the "deterministic font measurement interface" the RFC requires, narrowed honestly.
5. **Entry-requirement classification (§8)** uses a documented, versioned pattern-based
   closed policy over `StoryGate.requirementsBeforeRender` strings (RFC-0005 does not
   type these), defaulting unknown text to "narrative" (safe default — never silently
   admits an ambiguous requirement as renderer-bound).
