# RFC-0006 — Renderer-Neutral Render Planning & Technical Render Gate v0.1

Status: Accepted for implementation
Implementation: Not started
Depends on: RFC-0001 through RFC-0005
Primary input: accepted canonical RFC-0005 `Storyboard`

---

## 1. Status and executive summary

RFC-0005 decides what the demo says and shows. It produces exactly one immutable, renderer-independent canonical `Storyboard`, including its narrative authority, Hero Interaction, claims, evidence references, scene order, semantic presentation intent, duration in milliseconds, `RendererReadiness`, and Story Gate.

RFC-0006 defines the deterministic technical bridge from that Storyboard to a renderer adapter:

```text
Canonical Storyboard
→ entry validation
→ output-profile resolution
→ asset resolution and preparation
→ renderer-neutral Render Plan compilation
→ objective technical validation
→ adapter-capability validation
→ one technical Render Gate
→ renderer adapter compilation
```

RFC-0006 owns Render Plan compilation and one technical pre-render Render Gate. It does not render frames, export MP4, change the Storyboard, reinterpret evidence, generate text, or evaluate subjective visual quality.

The Render Gate runs before adapter compilation and consumes an immutable adapter-capabilities snapshot. Its status is:

```ts
type RenderGateStatus = "pass" | "conditional" | "fail";
```

A conditional plan MUST remain technically executable. Critical failures are never overridable.

---

## 2. Problem statement

A Storyboard intentionally does not specify:

- Output geometry or rational frame rate.
- Integer frame boundaries.
- Concrete files for evidence references.
- Mechanical media preparation.
- Objective layer geometry.
- Concrete transition realization.
- Adapter compatibility.

If adapters decide these privately, they can diverge, change timing, silently choose different assets, or substitute presentation behavior. RFC-0006 normalizes those renderer-bound decisions into an immutable, auditable `RenderPlan` and validates whether that exact plan is technically executable by the declared adapter.

---

## 3. Goals

RFC-0006 MUST provide:

1. An implementation-ready `RenderCompilerInput`.
2. A renderer-neutral canonical `RenderPlan`.
3. Explicit, versioned output profiles.
4. Exact rational frame calculations.
5. Deterministic cumulative-boundary quantization.
6. Source-agnostic asset provenance and deterministic resolution.
7. Mechanical, policy-driven asset preparation.
8. Objective layout, text, timing, and capability constraints.
9. An immutable adapter-capabilities snapshot.
10. One technical Render Gate.
11. A general typed finding model covering every pipeline stage.
12. A closed v0.1 reason-code registry.
13. Narrow non-critical overrides.
14. Typed next-action requirements.
15. Stable serialization and reproducible IDs.
16. Existing `ArtifactEnvelope` and registry reuse.
17. Testability without rendering a frame.

---

## 4. Non-goals

RFC-0006 MUST NOT:

- Change story mode, arc, Hero Interaction, claims, proof chains, beats, scenes, sequences, ownership, or order.
- Re-run or compete with the Story Gate.
- Resolve narrative, truth, approval, or Hero-authority deficiencies.
- Mutate the canonical Storyboard.
- Generate or reinterpret evidence.
- Silently substitute unsupported evidence.
- Rewrite, summarize, or truncate text.
- Call external AI services.
- Score subjective visual quality.
- introduce Remotion-specific core contracts.
- Compile an adapter-specific composition.
- Render frames or video.
- Encode, mux, package, or export MP4.
- Run pixel, decoded-video, audio/video, codec, or container checks.
- Create a competing artifact registry.

---

## 5. Terminology

| Term | Definition |
|---|---|
| Canonical Storyboard | The single immutable Storyboard accepted under RFC-0005. |
| Story Gate | RFC-0005's narrative gate. RFC-0006 neither defines nor recalculates it. |
| RendererReadiness | RFC-0005's artifact-availability assessment contributing to the Story Gate. |
| Render Plan | Canonical technical plan containing timing, layers, valid resolved assets, transitions, constraints, and capability requirements. |
| Render Finding | General typed result produced by any RFC-0006 pipeline stage. |
| Constraint Finding | Specialized Render Finding produced by objective constraint evaluation. |
| Transition window | Effect-local sampling window using the tail of one scene and head of the next without changing either canonical scene range. |
| Resolved asset | Uniquely selected asset that has passed integrity validation. |
| Render Gate | Single technical pre-adapter-compilation verdict for a canonical Render Plan. |
| Render rejection | Typed artifact emitted when no canonical Render Plan can be produced. |
| Render requirement | Typed allowed next action associated with a gate finding. |
| Post-render validation | Validation requiring produced frames, audio, video, or a container. |

---

## 6. Architectural boundary with RFC-0005

RFC-0005 permanently owns:

- Narrative facts, claims, and truth status.
- Human-authority-first Hero Interaction selection.
- Story mode and narrative arc.
- Proof chains and evidence references.
- Beat selection and exclusive beat ownership.
- Scene construction, order, and exclusive sequence ownership.
- Semantic presentation and transition intent.
- Narrative duration in milliseconds.
- The Story Gate.
- `RendererReadiness`.

RFC-0006 MAY:

- Bind approved evidence references to concrete artifacts.
- Validate artifact existence, integrity, and compatibility.
- Apply deterministic mechanical preparation.
- Quantize authoritative milliseconds into frames.
- Map semantic transition intent through a named renderer-neutral policy.
- Define technical layers and objective geometry.
- Reject technical incompatibility.

RFC-0006 MUST NOT modify RFC-0005-owned values to make rendering succeed.

---

## 7. Ownership matrix

| Responsibility | Sole owner |
|---|---|
| Narrative authority, Hero Interaction, claims | RFC-0005 |
| Beat/scene ownership and order | RFC-0005 |
| Storyboard duration milliseconds | RFC-0005 |
| Preliminary artifact availability | RFC-0005 `RendererReadiness` |
| Entry eligibility classification | RFC-0006 |
| Output-profile resolution | RFC-0006 |
| Asset binding and resolution | RFC-0006 |
| Mechanical asset preparation | RFC-0006 preparation service |
| Frame quantization | RFC-0006 |
| Renderer-neutral layers and geometry | RFC-0006 |
| Objective pre-render checks | RFC-0006 |
| Capability declaration | Renderer adapter, as immutable artifact |
| Capability comparison and Render Gate | RFC-0006 |
| Adapter-specific composition | Renderer adapter |
| Frame/video production | Renderer runtime |
| MP4/container packaging | Export layer |
| Pixel/video/container validation | Post-render validator |
| Subjective visual review | Human or future critic |
| Voice/caption generation | Future voice/caption compiler |

---

## 8. Entry eligibility and Story Gate relationship

A Story Gate with `status: "fail"` MUST NOT enter RFC-0006.

A Story Gate with `status: "pass"` MAY enter after artifact, hash, schema, and input validation.

A Story Gate with `status: "conditional"` MAY enter only when every unresolved prerequisite is explicitly classified as renderer-bound.

Renderer-bound requirements include:

- Resolve or recapture an otherwise narratively approved artifact.
- Mechanically prepare an approved artifact.
- Select an explicit output profile.
- Satisfy an objective layout or capability requirement.

The following are never renderer-bound:

- Missing narrative or Hero approval.
- Unsupported or unverified claim.
- Missing narrative beat.
- Broken proof chain.
- Narrative contradiction.
- Required change to Storyboard order, ownership, text, claim, or Hero Interaction.

### Entry algorithm

```text
evaluateEntry(input, storyboardEnvelope):
  validate every mandatory scalar and policy field as non-empty
  verify storyboard artifact identity and expected content hash
  validate Storyboard schema and internal references

  if Story Gate status is fail:
    emit unsatisfied RenderFinding(STORY_GATE_INELIGIBLE)
    reject

  if Story Gate status is conditional:
    for each typed requirement in canonical order:
      classification = closedEntryPolicy.classify(requirement)
      if classification is not renderer-bound:
        emit unsatisfied RenderFinding(
          STORY_GATE_REQUIREMENT_NOT_RENDERER_BOUND
        )
        reject

  resolve all referenced policies, capabilities, tracks, and overrides
  return eligible
```

Eligibility MUST be determined from typed requirements or a versioned closed mapping. Free-form text alone MUST NOT authorize entry.

---

## 9. End-to-end render-planning pipeline

```text
1. Validate RenderCompilerInput
2. Resolve and hash-check Storyboard
3. Evaluate entry eligibility
4. Resolve output profile
5. Resolve required auxiliary tracks
6. Derive asset bindings
7. Normalize asset candidates
8. Select authoritative assets
9. Validate asset integrity
10. Perform required mechanical preparation
11. Compile renderer-neutral scenes and layers
12. Quantize cumulative scene boundaries
13. Map transitions and validate transition windows
14. Order layers
15. Evaluate objective constraints
16. Compare adapter capabilities
17. Evaluate non-critical overrides
18. Aggregate one Render Gate
19. Persist artifacts according to §40
```

Every stage MUST be deterministic and MUST NOT mutate its inputs.

All failures and successful evaluations MUST be representable by `RenderFinding`.

---

## 10. `RenderCompilerInput`

```ts
type VersionedPolicyReference = {
  readonly id: string;
  readonly version: string;
};

type RenderCompilerInput = {
  readonly schemaVersion: "0.1";
  readonly storyboardArtifactId: string;
  readonly expectedStoryboardContentHash: string;
  readonly outputProfile: RenderOutputProfileReference;
  readonly assetResolutionPolicy: VersionedPolicyReference;
  readonly transitionPolicy: VersionedPolicyReference;
  readonly layoutPolicy: VersionedPolicyReference;
  readonly adapterCapabilitiesArtifactId: string;
  readonly auxiliaryTrackArtifactIds: readonly string[];
  readonly overrideArtifactIds: readonly string[];
};
```

All scalar IDs, hashes, and versions MUST be non-empty after trimming.

Only collection fields may validly be empty. Their IDs MUST be unique and lexically normalized. Caller array order carries no authority.

---

## 11. Output profile contract

```ts
type Rational = {
  readonly numerator: number;
  readonly denominator: number;
};

type FrameRate =
  | {
      readonly kind: "integer";
      readonly framesPerSecond: number;
    }
  | {
      readonly kind: "rational";
      readonly numerator: number;
      readonly denominator: number;
    };

type RenderOutputProfileReference =
  | {
      readonly kind: "registered";
      readonly profileArtifactId: string;
      readonly expectedContentHash: string;
    }
  | {
      readonly kind: "inline-custom";
      readonly profile: RenderOutputProfile;
    };

type RenderOutputProfile = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly version: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelAspectRatio: Rational;
  readonly frameRate: FrameRate;
  readonly colorSpace: "srgb" | "display-p3" | "rec709";
  readonly safeAreaInsetsPx: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly audioMode: "none" | "optional" | "required";
};
```

No adapter-supplied implicit profile value is authoritative.

### Profile-resolution algorithm

```text
resolveProfile(reference):
  if registered:
    resolve artifact and verify expected hash
  else:
    use complete inline profile

  validate schema and semantic invariants
  reduce every rational
  normalize integer fps to fps/1 for calculations
  reject contradictory or impossible geometry/timebase
  return immutable resolved snapshot and provenance
```

---

## 12. Frame rate and rational timebase

All duration-to-frame calculations MUST use exact rational arithmetic.

For duration `d` milliseconds and rate `p/q` frames per second:

```text
exactFrames(d) = d × p / (1000 × q)
```

Intermediate floating-point values MUST NOT be authoritative.

Rationals MUST:

- Have positive denominators.
- Be reduced by greatest common divisor.
- Represent zero as `0/1`.
- Carry sign in the numerator only.

---

## 13. Cumulative frame-boundary quantization

The normative v0.1 policy is:

```text
id: cumulative-half-even
version: "0.1"
```

```text
quantizeScenes(orderedScenes, fps):
  cumulativeMs[0] = 0

  for i from 1 through sceneCount:
    cumulativeMs[i] =
      cumulativeMs[i - 1] + orderedScenes[i - 1].durationTargetMs

  for each boundary i:
    exact[i] =
      cumulativeMs[i] × fps.numerator /
      (1000 × fps.denominator)

    quantized[i] = exactRationalRoundHalfToEven(exact[i])
    delta[i] = quantized[i] - exact[i]

  require quantized[0] == 0
  totalFrames = quantized[sceneCount]

  for each scene i:
    start = quantized[i]
    endExclusive = quantized[i + 1]
    duration = endExclusive - start

    require duration > 0
    record exact boundary, quantized boundary, and delta

  require final endExclusive == totalFrames
  return timing manifest
```

Implementations MUST NOT redistribute residual frames, independently quantize scene durations, or assign frames based on adapter behavior or incidental traversal order.

A scene quantizing to zero frames MUST produce `TIMING_ALLOCATION_IMPOSSIBLE`. RFC-0006 MUST NOT lengthen it.

---

## 14. Duration and transition-window invariants

Storyboard milliseconds remain narrative authority.

For every scene:

- `startFrame` and `endFrameExclusive` MUST derive from adjacent cumulative boundaries.
- `durationFrames` MUST equal their difference.
- Canonical scene ranges MUST be contiguous and non-overlapping.
- Every canonical timeline frame index MUST belong to exactly one narrative scene.
- `totalFrames` MUST equal the last exclusive boundary.
- An adapter MUST preserve these values exactly.

### Transition windows

```ts
type RenderTransition = {
  readonly id: string;
  readonly policy: VersionedPolicyReference;
  readonly kind: RenderTransitionKind;
  readonly sourceStoryIntent: string;
  readonly leftSceneId: string;
  readonly rightSceneId: string;
  readonly transitionWindowFrames: number;
  readonly requiredCapabilityId: string;
};
```

For adjacent scenes:

```text
left  = [leftStart, boundary)
right = [boundary, rightEnd)
windowFrames = w

leftTail  = [boundary - w, boundary)
rightHead = [boundary, boundary + w)
```

The two ranges remain disjoint canonical timeline ranges.

The transition effect MAY use paired samples from `leftTail` and `rightHead` in an effect-local composition function. At every output timeline index:

- The index remains owned by its original narrative scene.
- Sampling another scene does not assign that sampled scene the same canonical index.
- The compositor MUST emit exactly one output frame for each existing canonical index.
- No additional output index is created.

A transition window MUST NOT:

- Change either scene boundary.
- Add or subtract total frames.
- Shift later scenes.
- Re-quantize duration.
- Cause two narrative scene timelines to share a canonical index.
- Permit adapter-side timing adjustment.

### Transition-window validation

```text
validateTransitionWindows(orderedScenes):
  for each adjacent pair (left, right):
    resolve at most one boundary transition
    require transition references exactly left and right
    require w >= 0
    require w <= left.durationFrames
    require w <= right.durationFrames
    require left.endFrameExclusive == right.startFrame
    require policy maps the Storyboard semantic intent
    require required layer visibility remains satisfiable

  reject transitions referencing non-neighboring scenes
  verify totalFrames and all canonical boundaries unchanged
```

---

## 15. Asset binding

```ts
type RenderAssetBinding = {
  readonly id: string;
  readonly storyboardSceneId: string;
  readonly renderLayerId: string;
  readonly evidenceRefId: string;
  readonly role: "primary" | "supporting" | "background";
  readonly criticality: "required" | "optional";
  readonly acceptableMediaTypes: readonly RenderMediaType[];
  readonly selectionPolicy: VersionedPolicyReference;
};
```

A binding MUST reference an existing Storyboard scene and an evidence reference authorized for that scene. It MUST NOT target unrelated evidence because a preferred asset is unavailable.

---

## 16. Asset candidate resolution

### Normalization

```text
normalizeCandidates(binding, registryRecords):
  collect records whose provenance satisfies binding.evidenceRefId

  for each record:
    validate provenance discriminant
    normalize media type, dimensions, duration, and hash
    record malformed candidates as RenderFindings
    exclude malformed candidates from eligibility

  deduplicate exact source identity plus content hash
  sort by canonical candidate key
  return eligible candidates plus findings
```

### Selection priority

1. Explicit evidence/artifact authority.
2. Exact source identity.
3. Acceptable media type.
4. Required dimensions and duration.
5. Capture-run authority already fixed by RFC-0005.
6. Versioned policy preference rank.
7. Content hash.
8. Artifact ID.
9. Source item ID.

Hash and ID comparisons provide canonical ordering only. They MUST NOT invent semantic authority.

### Selection algorithm

```text
selectAsset(binding, candidates, policy):
  eligible = candidates satisfying mandatory conditions

  if none:
    emit ASSET_BINDING_UNRESOLVED or ASSET_MISSING

  rank eligible candidates by semantic policy dimensions
  best = candidates sharing strongest semantic rank

  if best contains multiple distinct authoritative sources:
    emit ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS

  select sole authoritative best candidate
  record candidates, exclusions, ranks, policy, and decision
```

An unresolved tie MUST fail for a required binding. An optional binding MAY be omitted with a non-critical finding.

Filesystem enumeration order has no authority.

---

## 17. Source-agnostic asset provenance

```ts
type RenderAssetSource =
  | {
      readonly kind: "browser-capture";
      readonly sourceArtifactId: string;
      readonly sourceItemId: string;
      readonly sourceRunId: string;
    }
  | {
      readonly kind: "artifact";
      readonly sourceArtifactId: string;
      readonly sourceItemId?: string;
    }
  | {
      readonly kind: "generated-auxiliary-track";
      readonly sourceArtifactId: string;
      readonly sourceItemId?: string;
    };
```

Browser-specific fields MUST NOT be imposed on other source kinds.

---

## 18. Asset integrity validation

```text
evaluateAssetIntegrity(candidate):
  resolve bytes through approved registry/locator
  require bytes to exist
  calculate and compare content hash
  verify byte length when declared
  detect media type from bytes
  compare declared and detected types
  parse required media headers
  validate positive finite dimensions/duration where applicable
  reject corruption or unsupported required format
  return findings and, only on success, a valid resolved asset
```

Filename extensions alone MUST NOT establish media type or validity.

Malformed, missing, corrupt, hash-mismatched, or unsupported candidates MUST appear in findings and resolution provenance. They MUST NOT appear as usable resolved assets.

```ts
type ResolvedRenderAsset = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly bindingId: string;
  readonly evidenceRefId: string;
  readonly source: RenderAssetSource;
  readonly sourceContentHash: string;
  readonly mediaType: RenderMediaType;
  readonly byteLength: number;
  readonly intrinsicWidthPx?: number;
  readonly intrinsicHeightPx?: number;
  readonly intrinsicDurationMs?: number;
  readonly preparedArtifactId?: string;
  readonly preparedContentHash?: string;
  readonly preparationRequirementIds: readonly string[];
};
```

Inclusion in `resolvedAssets` normatively proves integrity validation passed. There is no invalid integrity state in this contract.

Optional unavailable assets MAY be omitted according to policy. They MUST NOT appear as invalid resolved assets.

---

## 19. Asset-preparation boundary

```ts
type AssetPreparationRequirement = {
  readonly id: string;
  readonly bindingId: string;
  readonly operation:
    | "resize-contain"
    | "resize-cover"
    | "lossless-normalize"
    | "transcode"
    | "crop-declared-region";
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly required: boolean;
  readonly policy: VersionedPolicyReference;
};
```

Preparation MUST:

- Be mechanical, deterministic, and policy-driven.
- Produce a new immutable artifact.
- Preserve source hash, operation, parameters, policy, and tool provenance.
- Validate the prepared output before admitting it to the plan.

Cropping MUST derive from an upstream-authorized region or objective layout rule. It MUST NOT introduce semantic selection.

---

## 20. `RenderPlan`

```ts
type RenderPlan = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly storyboardArtifactId: string;
  readonly storyboardContentHash: string;
  readonly outputProfileSource: RenderOutputProfileReference;
  readonly resolvedOutputProfile: RenderOutputProfile;
  readonly timing: RenderTimingManifest;
  readonly scenes: readonly RenderScene[];
  readonly assetBindings: readonly RenderAssetBinding[];
  readonly resolvedAssets: readonly ResolvedRenderAsset[];
  readonly preparationRequirements: readonly AssetPreparationRequirement[];
  readonly constraints: readonly RenderConstraint[];
  readonly requiredCapabilityIds: readonly string[];
  readonly provenance: RenderProvenance;
};
```

A canonical Render Plan MUST:

- Contain only integrity-valid resolved assets.
- Preserve Storyboard scene identity and order.
- Embed the resolved output-profile snapshot.
- Contain deterministic timing.
- Contain no adapter-specific composition structures.
- Be immutable after emission.

A structurally valid canonical plan may exist even when capability or other later technical findings cause the Render Gate to fail.

---

## 21. `RenderScene`

```ts
type RenderScene = {
  readonly id: string;
  readonly storyboardSceneId: string;
  readonly storyboardSequenceId: string;
  readonly order: number;
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly durationFrames: number;
  readonly narrativeDurationMs: number;
  readonly transitionIn: RenderTransition | null;
  readonly transitionOut: RenderTransition | null;
  readonly layers: readonly RenderLayer[];
  readonly constraintIds: readonly string[];
  readonly requiredCapabilityIds: readonly string[];
};
```

Every Render Scene MUST map to exactly one Storyboard scene. No Storyboard scene may map to multiple top-level Render Scenes in v0.1.

---

## 22. `RenderLayer`

```ts
type RenderLayer =
  | RenderAssetLayer
  | RenderTextLayer
  | RenderShapeLayer
  | RenderReservedRegionLayer;

type RenderLayerBase = {
  readonly id: string;
  readonly kind: "asset" | "text" | "shape" | "reserved-region";
  readonly zIndex: number;
  readonly geometry: RenderGeometry;
  readonly activeFrameRange: FrameRange;
  readonly criticality: "required" | "optional";
  readonly styleTokenIds: readonly string[];
  readonly constraintIds: readonly string[];
};
```

Asset, text, shape, and reserved-region specializations MUST use closed discriminants. Layers MUST NOT contain invented claim text.

---

## 23. Geometry and coordinate system

```ts
type RenderGeometry = {
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
};

type FrameRange = {
  readonly startFrame: number;
  readonly endFrameExclusive: number;
};
```

The origin is the top-left output pixel. Positive X extends right and positive Y extends down. Bounds and frame ranges are half-open.

Required content MUST remain within the output frame. Safe-area checks MUST use the resolved profile.

---

## 24. Deterministic layer ordering

Layers MUST sort by:

```text
(zIndex, kindRank, id)
```

The v0.1 kind rank is:

```text
shape = 0
asset = 1
text = 2
reserved-region = 3
```

IDs use Unicode code-point lexical comparison. Locale-sensitive ordering and caller array order MUST NOT resolve ties.

---

## 25. Transition realization policy

```ts
type RenderTransitionKind =
  | "cut"
  | "hold"
  | "cross-reveal"
  | "replace"
  | "focus"
  | "continuity"
  | "before-after"
  | "proof-result"
  | "conclusion";
```

A named renderer-neutral policy MUST map every supported RFC-0005 semantic transition intent to a closed Render transition kind and deterministic transition window.

Adapters MUST realize the declared transition without changing scene ranges or total frames. They MUST NOT privately substitute another transition.

---

## 26. Text and typography constraints

```ts
type RenderTextSource =
  | {
      readonly kind: "storyboard-authorized";
      readonly storyboardSceneId: string;
      readonly sourceField: "title" | "purpose";
    }
  | {
      readonly kind: "approved-variant";
      readonly auxiliaryArtifactId: string;
      readonly variantId: string;
    }
  | {
      readonly kind: "caption-cue";
      readonly auxiliaryArtifactId: string;
      readonly cueId: string;
    };
```

Typography policies MUST declare immutable font identity, measurement engine/version, font bounds, line-height, letter spacing, line-breaking, and maximum lines.

Text measurement MUST be deterministic.

---

## 27. Text overflow and approved variants

The compiler MAY reduce font size only within approved bounds and without altering text.

Approved variants MUST have an explicit authoritative priority:

```ts
type ApprovedTextVariant = {
  readonly id: string;
  readonly authoritativePriority: number;
  readonly textSourceArtifactId: string;
  readonly textSourceItemId: string;
};
```

Lower numeric priority is stronger in v0.1.

Variant ordering MUST be:

```text
(authoritativePriority ascending, variantId lexical ascending)
```

Variant ID is only a deterministic tie-breaker. It MUST NOT override explicit priority.

The fitting procedure MUST:

1. Attempt the original authoritative text.
2. Select the greatest fitting approved font size.
3. If it does not fit, evaluate approved variants by authoritative priority.
4. Use variant ID only between equal-priority variants.
5. Emit `TEXT_OVERFLOW` if no authorized variant fits.

RFC-0006 MUST NOT rewrite, summarize, remove words, truncate, or add ellipses.

---

## 28. Voice/caption auxiliary-track boundary

RFC-0006 does not generate voice, captions, narration, subtitle prose, or audio.

If a required auxiliary track affects duration, timing, geometry, reserved regions, or capabilities, it MUST exist and validate before final plan compilation.

Optional absence MUST be explicit and MUST NOT trigger an adapter behavior that changes timing.

---

## 29. `AdapterCapabilities`

```ts
type AdapterCapabilities = {
  readonly schemaVersion: "0.1";
  readonly adapter: {
    readonly name: string;
    readonly version: string;
  };
  readonly declarationVersion: string;
  readonly supportedLayerKinds: readonly RenderLayer["kind"][];
  readonly supportedMediaTypes: readonly RenderMediaType[];
  readonly supportedTransitions: readonly RenderTransitionKind[];
  readonly supportedTypographyFeatures: readonly string[];
  readonly supportedEffects: readonly string[];
  readonly widthRangePx: CapabilityRange;
  readonly heightRangePx: CapabilityRange;
  readonly supportedFrameRates: readonly FrameRate[];
  readonly supportedColorSpaces: readonly RenderOutputProfile["colorSpace"][];
  readonly supportedAudioModes: readonly RenderOutputProfile["audioMode"][];
  readonly maximumLayerCountPerScene: number;
};
```

The declaration MUST be immutable, versioned, schema-valid, content-hashed, and canonically ordered.

---

## 30. Capability negotiation

```text
compareCapabilities(plan, capabilities):
  compare dimensions, exact timebase, color space, and audio mode
  compare each required capability ID
  compare scene layer counts
  compare every layer kind and resolved media type
  compare typography requirements
  compare transition kinds

  emit a RenderFinding for each comparison
```

Unsupported required capability MUST fail the Render Gate.

Any optional fallback MUST already be selected by a versioned policy and represented in the canonical plan. The adapter MUST NOT choose it privately.

---

## 31. Objective `RenderConstraint` model

```ts
type RenderConstraint =
  | BoundsConstraint
  | SafeAreaConstraint
  | MinimumSizeConstraint
  | NonOverlapConstraint
  | TextFitConstraint
  | RequiredRegionConstraint
  | TimingConstraint
  | CapabilityConstraint;

type ConstraintBase = {
  readonly id: string;
  readonly kind:
    | "bounds"
    | "safe-area"
    | "minimum-size"
    | "non-overlap"
    | "text-fit"
    | "required-region"
    | "timing"
    | "capability";
  readonly targetIds: readonly string[];
  readonly criticality: "critical" | "non-critical";
  readonly policy: VersionedPolicyReference;
  readonly failureCode: RenderGateReasonCode;
};
```

Constraints MUST be objective and machine-evaluable. Subjective scores are prohibited.

---

## 32. General `RenderFinding` and Render Gate contracts

### General finding

```ts
type RenderFindingOutcome = "satisfied" | "unsatisfied";

type RenderFindingSource =
  | {
      readonly kind: "entry";
      readonly inputField?: string;
    }
  | {
      readonly kind: "profile-resolution";
      readonly profileId?: string;
    }
  | {
      readonly kind: "auxiliary-track";
      readonly artifactId?: string;
    }
  | {
      readonly kind: "asset-binding";
      readonly bindingId: string;
    }
  | {
      readonly kind: "asset-resolution";
      readonly bindingId: string;
      readonly candidateId?: string;
    }
  | {
      readonly kind: "asset-integrity";
      readonly candidateId: string;
    }
  | {
      readonly kind: "asset-preparation";
      readonly preparationRequirementId: string;
    }
  | {
      readonly kind: "plan-structure";
      readonly planElementId?: string;
    }
  | {
      readonly kind: "timing";
      readonly sceneId?: string;
      readonly boundaryIndex?: number;
    }
  | {
      readonly kind: "transition";
      readonly transitionId: string;
    }
  | {
      readonly kind: "constraint";
      readonly constraintId: string;
    }
  | {
      readonly kind: "adapter-capability";
      readonly capabilityId: string;
    }
  | {
      readonly kind: "override";
      readonly overrideId: string;
    }
  | {
      readonly kind: "gate-aggregation";
      readonly aggregationRuleId: string;
    };

type RenderFinding = {
  readonly id: string;
  readonly stage: RenderPipelineStage;
  readonly reasonCode: RenderGateReasonCode;
  readonly outcome: RenderFindingOutcome;
  readonly criticality: "critical" | "non-critical";
  readonly affectedIds: readonly string[];
  readonly evidence: readonly RenderFindingEvidence[];
  readonly source: RenderFindingSource;
};
```

Every finding ID MUST be stable for equivalent inputs.

Every Render Gate failure type MUST be representable by this contract.

### Specialized constraint subtype

```ts
type RenderConstraintFinding = RenderFinding & {
  readonly stage: "layout" | "timing" | "capability-negotiation";
  readonly source: {
    readonly kind: "constraint";
    readonly constraintId: string;
  };
};
```

`RenderConstraintFinding` MUST NOT be used as the universal finding type.

### Typed requirements

```ts
type RenderAllowedNextAction =
  | "correct-render-input"
  | "resolve-upstream-story-requirement"
  | "restore-artifact"
  | "recapture-authorized-evidence"
  | "select-authoritative-asset"
  | "prepare-asset"
  | "select-output-profile"
  | "select-compatible-adapter"
  | "revise-versioned-policy"
  | "provide-approved-text-variant"
  | "compile-required-auxiliary-track"
  | "remove-invalid-override"
  | "retry-render-planning";

type RenderRequirement = {
  readonly id: string;
  readonly reasonCode: RenderGateReasonCode;
  readonly allowedNextAction: RenderAllowedNextAction;
  readonly affectedIds: readonly string[];
};
```

### Render Gate

```ts
type RenderGateStatus = "pass" | "conditional" | "fail";

type RenderWarning = {
  readonly id: string;
  readonly findingId: string;
  readonly reasonCode: RenderGateReasonCode;
  readonly affectedIds: readonly string[];
  readonly evidence: readonly RenderFindingEvidence[];
  readonly appliedOverrideId?: string;
};

type RenderGateResult = {
  readonly schemaVersion: "0.1";
  readonly name: "render";
  readonly status: RenderGateStatus;
  readonly renderPlanArtifactId: string | null;
  readonly blockingFindings: readonly RenderFinding[];
  readonly warnings: readonly RenderWarning[];
  readonly requirementsBeforeRender: readonly RenderRequirement[];
  readonly appliedOverrideIds: readonly string[];
  readonly provenance: RenderProvenance;
};
```

---

## 33. Gate status aggregation

```text
aggregateGate(planOrNull, findings, overrides):
  validatedOverrides = evaluateOverrides(findings, overrides)
  blocking = []
  warnings = []
  requirements = []

  for finding in canonicalFindingOrder(findings):
    if finding.outcome == satisfied:
      continue

    if finding.criticality == critical:
      blocking.append(finding)
      requirements.append(requirementFor(finding))
      continue

    if valid override exists:
      warnings.append(warning retaining original finding and override ID)
    else if reason registry effect is conditional:
      warnings.append(warning from finding)
    else:
      blocking.append(finding)
      requirements.append(requirementFor(finding))

  if planOrNull is null:
    return rejection rather than RenderGateResult

  if blocking is not empty:
    status = fail
  else if warnings is not empty:
    status = conditional
  else:
    status = pass

  if status is pass or conditional:
    require plan is technically executable

  return RenderGateResult
```

All findings, including non-constraint failures, use `RenderFinding`.

---

## 34. Criticality propagation

A finding is critical when it affects:

- Entry eligibility.
- Storyboard identity or references.
- A critical or `mustAppear` Storyboard scene.
- A required binding, layer, track, or capability.
- Profile consistency.
- Timebase or boundary invariants.
- Required content visibility.
- Structural plan validity.
- Safety or privacy.

A finding is non-critical only when all affected items are explicitly optional and the plan remains executable without them.

Mixed criticality MUST be elevated to critical or split into separate findings.

---

## 35. Non-critical override policy

```ts
type RenderOverrideRecord = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly findingId: string;
  readonly reasonCode: RenderGateReasonCode;
  readonly authority: {
    readonly kind: "human";
    readonly authorityId: string;
  };
  readonly rationale: string;
  readonly policy: VersionedPolicyReference;
  readonly createdAt: string;
  readonly reversible: true;
};
```

Overrides are eligible only when the finding is non-critical, allowlisted, and technically executable.

The original finding MUST remain visible.

Critical findings and final fail statuses MUST NOT be overridden.

---

## 36. Failure taxonomy

The closed reason-code union remains:

```ts
type RenderGateReasonCode =
  | "RENDER_COMPILER_INPUT_INVALID"
  | "STORY_GATE_INELIGIBLE"
  | "STORY_GATE_REQUIREMENT_NOT_RENDERER_BOUND"
  | "STORYBOARD_NOT_FOUND"
  | "STORYBOARD_HASH_MISMATCH"
  | "STORYBOARD_REFERENCE_INVALID"
  | "DEPENDENCY_ARTIFACT_NOT_FOUND"
  | "OUTPUT_PROFILE_NOT_FOUND"
  | "OUTPUT_PROFILE_HASH_MISMATCH"
  | "OUTPUT_PROFILE_INVALID"
  | "OUTPUT_PROFILE_CONTRADICTORY"
  | "OUTPUT_PROFILE_UNSUPPORTED"
  | "REQUIRED_AUXILIARY_TRACK_MISSING"
  | "REQUIRED_AUXILIARY_TRACK_INVALID"
  | "RENDER_PLAN_STRUCTURALLY_INVALID"
  | "REQUIRED_LAYER_UNREALIZABLE"
  | "TIMING_ALLOCATION_IMPOSSIBLE"
  | "FRAME_ROUNDING_INVARIANT_FAILED"
  | "TRANSITION_POLICY_UNRESOLVED"
  | "TRANSITION_OVERLAP_INVALID"
  | "ASSET_BINDING_UNRESOLVED"
  | "ASSET_MISSING"
  | "ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS"
  | "ASSET_HASH_MISMATCH"
  | "ASSET_CORRUPT"
  | "ASSET_FORMAT_UNSUPPORTED"
  | "ASSET_STALE"
  | "ASSET_PREPARATION_FAILED"
  | "CONTENT_OUT_OF_FRAME"
  | "SAFE_AREA_VIOLATION"
  | "MINIMUM_SIZE_VIOLATION"
  | "REQUIRED_ELEMENTS_OVERLAP"
  | "RESERVED_REGION_MISSING"
  | "TEXT_OVERFLOW"
  | "ADAPTER_CAPABILITIES_NOT_FOUND"
  | "ADAPTER_CAPABILITIES_HASH_MISMATCH"
  | "ADAPTER_CAPABILITIES_INVALID"
  | "ADAPTER_LAYER_UNSUPPORTED"
  | "ADAPTER_SCENE_UNSUPPORTED"
  | "ADAPTER_TRANSITION_UNSUPPORTED"
  | "ADAPTER_TYPOGRAPHY_UNSUPPORTED"
  | "ADAPTER_MEDIA_TYPE_UNSUPPORTED"
  | "ADAPTER_DIMENSIONS_UNSUPPORTED"
  | "ADAPTER_TIMEBASE_UNSUPPORTED"
  | "ADAPTER_COLOR_SPACE_UNSUPPORTED"
  | "ADAPTER_AUDIO_MODE_UNSUPPORTED"
  | "OPTIONAL_ASSET_UNAVAILABLE"
  | "OPTIONAL_ASSET_RECAPTURE_RECOMMENDED"
  | "NON_CRITICAL_LAYOUT_DEGRADATION"
  | "OVERRIDE_INVALID"
  | "OVERRIDE_NOT_ALLOWLISTED";
```

Every code MUST produce a general `RenderFinding`. Constraint-originated codes MAY produce the specialized subtype.

Post-render-only codes remain a separate union and MUST NOT enter the Render Gate:

```ts
type PostRenderReasonCode =
  | "RENDERED_FRAME_COUNT_MISMATCH"
  | "RENDERED_OUTPUT_DECODE_FAILURE"
  | "RENDERED_DIMENSION_MISMATCH"
  | "BLACK_OR_EMPTY_REQUIRED_FRAME"
  | "MISSING_RENDERED_LAYER"
  | "AUDIO_VIDEO_DURATION_MISMATCH"
  | "CONTAINER_INVALID"
  | "EXPORT_CODEC_MISMATCH"
  | "POST_RENDER_SAFE_AREA_VIOLATION";
```

The stage, criticality, gate effect, override eligibility, evidence, and next-action registry from the previous draft remains normative, now producing `RenderFinding` and typed `RenderRequirement`.

---

## 37. Determinism and canonical serialization

Equivalent inputs MUST produce byte-identical canonical plan payloads.

Rules include:

- Stable recursive object-key ordering.
- Unicode code-point lexical comparison.
- Contract-specific array ordering.
- Cumulative rational quantization.
- No filesystem-order authority.
- No random canonical IDs.
- Reduced rationals.
- Stable general finding order.

General findings MUST sort by:

```text
(
  pipelineStageRank,
  reasonCode,
  criticalityRank,
  affectedIds lexical tuple,
  source.kind,
  findingId
)
```

Constraint findings use the same universal order.

### Serialization algorithm

```text
canonicalSerialize(payload):
  validate schema
  normalize rationals and discriminants
  deduplicate set-valued arrays
  apply contract-specific array ordering
  recursively sort object keys by Unicode code point
  serialize canonical UTF-8 JSON without insignificant whitespace
```

---

## 38. Storyboard immutability

The Storyboard artifact and hash MUST be verified before compilation.

No RFC-0006 stage may mutate it. The hash SHOULD be verified again after compilation.

Render Scenes MUST preserve Storyboard scene identity, order, ownership, Hero Interaction relationships, and evidence references.

---

## 39. Provenance

`RenderProvenance` MUST capture:

- Storyboard artifact ID, schema version, and hash.
- Output-profile source, ID, version, and hash.
- Adapter-capabilities artifact ID, adapter version, and hash.
- Every policy ID/version.
- Compiler identity/version.
- Dependency artifact IDs.
- Exact quantization boundaries and deltas.
- Asset candidate exclusions and resolution decisions through resolved-assets provenance.
- Applied override IDs.

Provenance MUST remain immutable and auditable.

---

## 40. Artifact policy and emission cases

RFC-0006 MUST reuse the existing artifact envelope and registry.

### Case A — No canonical Render Plan can be produced

Examples include invalid entry, unresolved required assets, corrupt required inputs, or structural/timing failure preventing plan construction.

The pipeline MUST:

- Emit a typed `RenderRejection`.
- Not emit a canonical Render Plan.
- Not describe any provisional internal structure as canonical.

```ts
type RenderRejection = {
  readonly schemaVersion: "0.1";
  readonly status: "rejected";
  readonly stage: RenderPipelineStage;
  readonly reasonCodes: readonly RenderGateReasonCode[];
  readonly findings: readonly RenderFinding[];
  readonly requirements: readonly RenderRequirement[];
  readonly inputArtifactIds: readonly string[];
  readonly provenance: RenderProvenance;
};
```

### Case B — Canonical plan exists, Render Gate fails

Examples include incompatibility between a structurally valid canonical plan and the chosen adapter-capabilities snapshot.

The pipeline MUST emit:

1. Resolved-assets artifact.
2. Canonical Render Plan artifact.
3. Render Gate artifact with `status: "fail"`.

The plan MUST remain available for retry with another adapter, capability snapshot, or accepted policy. A failed gate MUST NOT imply that the canonical plan was absent.

### Case C — Canonical plan exists, gate passes or is conditional

The pipeline MUST emit:

1. Resolved-assets artifact.
2. Canonical Render Plan artifact.
3. Render Gate artifact with `status: "pass"` or `"conditional"`.

Conditional outputs remain:

- Preparation manifest.
- Prepared immutable assets.
- Override artifact.
- Separate timing manifest.
- Auxiliary-track artifacts.

The Storyboard, registered profile, and capability declaration remain referenced immutable inputs. They are not copied merely to satisfy an artifact inventory.

---

## 41. Security and privacy

RFC-0006 MUST preserve upstream redaction and sanitization.

It MUST NOT embed secrets, cookies, headers, credentials, raw DOM dumps, unrelated private content, or evidence bytes in JSON artifacts.

Prepared assets inherit source sensitivity and retention metadata. Findings SHOULD contain IDs, hashes, measurements, and policy results rather than raw content.

---

## 42. CLI behavior and exit codes

Recommended command:

```text
npm run compile-render -- <path-to-render-input>
```

The CLI MUST:

- Validate required inputs.
- Never prompt for missing authority.
- Never fill fields using adapter behavior.
- Report artifact IDs, plan ID when present, gate status, and finding counts.
- Avoid printing sensitive content.

Exit codes:

- `0`: canonical plan with `pass` or `conditional`.
- `1`: rejection, gate `fail`, invalid input, or pipeline exception.

For Case B, exit code `1` MUST still report and preserve the emitted plan artifact.

---

## 43. Post-render validation boundary

RFC-0006 MAY define `PostRenderValidationRequest` but does not execute it.

Frame count, pixel presence, decodability, actual dimensions, audio/video synchronization, codec, and container checks remain post-render.

Post-render findings MUST NOT retroactively change the historical Render Gate.

---

## 44. Verification invariants

A conforming implementation MUST verify:

1. Every pipeline result is representable by `RenderFinding`.
2. `RenderConstraintFinding` is used only for constraint-originated findings.
3. Story Gate fail never enters.
4. Conditional entry is renderer-bound.
5. Storyboard hash and structure remain unchanged.
6. Hero Interaction and ownership remain unchanged.
7. Output profiles are explicit.
8. Frame arithmetic is exact.
9. Quantization uses cumulative half-to-even.
10. No residual frames are redistributed.
11. Transition windows do not change scene boundaries or runtime.
12. No canonical timeline index belongs to two narrative scenes.
13. Adapters cannot adjust timing.
14. Required asset selection is unique.
15. Invalid assets never appear in `resolvedAssets`.
16. Optional unavailable assets are omitted and reported.
17. Prepared assets are valid and traceable.
18. Text variant priority precedes lexical ID.
19. Text is never rewritten or truncated.
20. Unsupported required capabilities fail.
21. Critical findings are never overridden.
22. Conditional plans remain executable.
23. Gate requirements are typed.
24. Case A, B, and C emissions follow §40.
25. Gate-failed canonical plans remain persisted.
26. Post-render codes cannot appear in Render Gate artifacts.
27. Core contracts remain adapter-neutral.
28. Existing artifact conventions are reused.
29. Equivalent inputs produce identical canonical bytes.

---

## 45. Testing strategy

Future tests MUST cover:

- General `RenderFinding` construction for every pipeline stage.
- Constraint-finding specialization.
- Rejection and gate schemas using general findings.
- Stable finding IDs and canonical order.
- Typed Render requirements and closed actions.
- Runtime schemas for all contracts.
- Profile resolution.
- Source-agnostic asset provenance.
- Missing, malformed, corrupt, ambiguous, stale, and unsupported candidates.
- Proof that invalid assets cannot enter canonical plans.
- Optional unavailable-asset omission.
- Mechanical preparation.
- Rational frame rates and fractional durations.
- Cumulative half-to-even boundaries.
- No residual redistribution.
- Transition-window tail/head ranges.
- No runtime or boundary change from transitions.
- No shared canonical scene index.
- Adapter timing immutability.
- Text-fit and explicit variant priority.
- Lexical ID tie-breaking only at equal priority.
- Safe area, bounds, minimum size, and overlap.
- Capability mismatch.
- Non-critical overrides.
- Critical override rejection.
- Case A rejection emission.
- Case B plan/assets/failing-gate emission.
- Case C plan/assets/pass-or-conditional emission.
- Filesystem-order independence.
- Storyboard immutability.
- Story Gate and `RendererReadiness` relationships.
- Hero and ownership preservation.
- Adapter-neutral contracts.
- Post-render boundary.
- CLI exit policy.
- Provenance completeness.

Golden fixtures MUST include a structurally valid plan that fails only against one adapter snapshot and passes unchanged against another.

---

## 46. Worked examples

### Fully renderable

Valid Storyboard, assets, profile, layout, timing, and adapter capabilities produce Case C with `pass`.

### Missing critical asset

No valid asset can satisfy a required proof binding. No canonical plan can be completed. Case A emits rejection with `ASSET_MISSING`.

### Adapter lacks required transition

A canonical plan exists, but the selected adapter lacks its required transition. Case B persists resolved assets and plan, then emits a failed gate with `ADAPTER_TRANSITION_UNSUPPORTED`.

### Optional stale asset

The optional asset is omitted, not represented as invalid. The plan remains executable. Case C emits `conditional`.

### Text variants

Variants have priorities:

```text
variant-z: priority 1
variant-a: priority 2
```

`variant-z` is evaluated first despite its lexically later ID. Lexical order applies only between variants sharing priority.

### Transition window

For:

```text
left scene:  [0, 60)
right scene: [60, 120)
window: 10 frames
```

the effect-local ranges are:

```text
left tail:  [50, 60)
right head: [60, 70)
```

Canonical ownership remains:

```text
0–59   left scene
60–119 right scene
totalFrames = 120
```

No frame is added, removed, shifted, or jointly owned.

---

## 47. Compatibility and migration

RFC-0006 consumes RFC-0005 Storyboard v0.1 without modifying it.

Implementations SHOULD reuse existing stable hashing, engine, artifact-envelope, registry, and CLI exit conventions.

Future Storyboard versions require an explicit compatibility adapter or RFC revision.

---

## 48. Deferred extensions

Deferred items remain:

- Voice/caption generation.
- Audio mixing.
- MP4 export.
- Post-render validator implementation.
- Perceptual critique.
- AI-assisted asset selection or cropping.
- Responsive layout families.
- Distributed rendering and caching.
- Advanced color workflows.
- Rich transition libraries.

---

## 49. Resolved v0.1 architecture decisions

D-01 through D-18 remain accepted.

This revision changes no architecture decision. It only:

- Generalizes the finding contract.
- Defines transition windows without runtime overlap.
- Excludes invalid assets from canonical plans.
- distinguishes all artifact-emission outcomes.
- corrects text-variant ordering.
- introduces typed gate requirements.

---

# Appendices

## Appendix A — Contract reference

Normative contracts include:

- `RenderCompilerInput`
- `RenderOutputProfileReference`
- `RenderOutputProfile`
- `FrameRate`
- `RenderPlan`
- `RenderTimingManifest`
- `RenderScene`
- `RenderLayer`
- `RenderTransition`
- `RenderAssetBinding`
- `RenderAssetSource`
- `ResolvedRenderAsset`
- `AssetPreparationRequirement`
- `AdapterCapabilities`
- `RenderConstraint`
- `RenderFinding`
- `RenderFindingSource`
- `RenderConstraintFinding`
- `RenderGateStatus`
- `RenderGateResult`
- `RenderGateReasonCode`
- `RenderWarning`
- `RenderRequirement`
- `RenderAllowedNextAction`
- `RenderOverrideRecord`
- `RenderProvenance`
- `RenderRejection`
- `PostRenderValidationRequest`

```ts
type RenderTimingManifest = {
  readonly schemaVersion: "0.1";
  readonly frameRate: FrameRate;
  readonly quantizationPolicy: {
    readonly id: "cumulative-half-even";
    readonly version: "0.1";
  };
  readonly totalNarrativeDurationMs: number;
  readonly totalFrames: number;
  readonly boundaries: readonly QuantizedBoundary[];
};

type RenderPipelineStage =
  | "entry"
  | "profile-resolution"
  | "auxiliary-track-resolution"
  | "asset-binding"
  | "asset-resolution"
  | "asset-integrity"
  | "asset-preparation"
  | "plan-compilation"
  | "timing"
  | "transition"
  | "layout"
  | "capability-negotiation"
  | "override-evaluation"
  | "gate-aggregation";
```

## Appendix B — JSON Schema inventory

Required future schemas:

1. Render compiler input.
2. Output profile.
3. Adapter capabilities.
4. Resolved render assets.
5. Preparation manifest.
6. Render Plan.
7. Timing manifest, if separate.
8. General Render Finding.
9. Render Gate.
10. Typed Render Requirement.
11. Override.
12. Rejection.
13. Post-render validation request.

The gate and rejection schemas MUST reference general `RenderFinding`, not `RenderConstraintFinding`.

## Appendix C — Reason-code registry

The closed reason-code union in §36 remains normative.

Every reason-code registry entry MUST define:

- Valid pipeline stages.
- Default and derived criticality.
- Gate effect.
- Override eligibility.
- Required typed evidence.
- Typed allowed next action.

Every entry produces a general `RenderFinding`.

## Appendix D — Reference output profile

```ts
const DPS_LANDSCAPE_1080P30_V01: RenderOutputProfile = {
  schemaVersion: "0.1",
  id: "dps-landscape-1080p30",
  version: "0.1",
  widthPx: 1920,
  heightPx: 1080,
  pixelAspectRatio: { numerator: 1, denominator: 1 },
  frameRate: { kind: "integer", framesPerSecond: 30 },
  colorSpace: "srgb",
  safeAreaInsetsPx: {
    top: 54,
    right: 96,
    bottom: 54,
    left: 96
  },
  audioMode: "optional"
};
```

This is an explicit reference profile, not an adapter fallback.

## Appendix E — Minimal transition and layout policies

The minimal transition policy MUST define:

- Semantic-intent mapping.
- Concrete transition kind.
- `transitionWindowFrames`.
- Required capability.
- Validation that scene boundaries and `totalFrames` remain unchanged.

The minimal layout policy MUST contain only objective checks:

- Frame bounds.
- Safe area.
- Minimum size.
- Required non-overlap.
- Text fit.
- Required reserved regions.

## Appendix F — Golden determinism fixtures

Required fixtures include:

1. Integral 30 fps boundaries.
2. Fractional `30000/1001` boundaries.
3. Exact half-to-even ties.
4. Zero-frame rejection.
5. Reversed asset enumeration.
6. Browser and non-browser provenance.
7. Invalid candidate excluded from resolved assets.
8. Optional unavailable asset omitted.
9. Transition window with unchanged runtime.
10. Explicit text priority preceding ID order.
11. Case A rejection.
12. Case B persisted plan with failing adapter.
13. Case C pass.
14. Stable general finding ordering.

## Appendix G — Entry and gate tables

### Entry

| Story Gate | Condition | Result |
|---|---|---|
| `pass` | References valid | Eligible |
| `pass` | Hash/reference invalid | Case A rejection |
| `conditional` | All requirements renderer-bound | Eligible |
| `conditional` | Any narrative/approval requirement | Case A rejection |
| `fail` | Any | Case A rejection |

### Plan and gate emission

| Canonical plan | Gate result | Required emission |
|---|---|---|
| No | Not applicable | Rejection only |
| Yes | `fail` | Resolved assets + plan + failed gate |
| Yes | `pass` | Resolved assets + plan + passed gate |
| Yes | `conditional` | Resolved assets + plan + conditional gate |

### Gate aggregation

| Blocking findings | Warnings/overrides | Executable | Status |
|---:|---:|---:|---|
| 0 | 0 | Yes | `pass` |
| 0 | ≥1 | Yes | `conditional` |
| ≥1 | Any | Any | `fail` |
| 0 | Any | No | `fail` |
