// RFC-0006 compiler input bundle. `RenderCompilerInput` (§10) references upstream
// artifacts by id/hash; per the same convention `compile-story.ts`/`StoryCompilerInput`
// already use (documented there: "in practice assembles those artifact payloads directly
// rather than describing raw source data"), the pure `RenderEngine` compiler consumes a
// bundle that carries those referenced payloads inline so it stays a pure function over
// plain data. Artifact-id-based registry resolution from the filesystem is left as CLI/
// integration follow-up (see Known Limitations in the implementation doc).
import type { Storyboard } from "./story.js";
import type {
  AdapterCapabilities,
  ApprovedTextVariant,
  RenderAssetSource,
  RenderCompilerInput,
  RenderMediaType,
  RenderOverrideRecord,
} from "./render.js";

/**
 * One candidate asset available to satisfy some evidence reference. `bytesBase64` carries
 * the actual candidate bytes so integrity validation (§18) can genuinely hash/sniff them —
 * no simulated pass/fail flags.
 */
export type RenderAssetCandidateRecord = {
  readonly id: string;
  readonly evidenceRefId: string;
  readonly source: RenderAssetSource;
  readonly declaredMediaType: RenderMediaType;
  readonly bytesBase64?: string;
  /** Authoritative provenance hash. Candidates without it are never eligible. */
  readonly expectedContentHash?: string;
  readonly declaredByteLength?: number;
  readonly declaredWidthPx?: number;
  readonly declaredHeightPx?: number;
  readonly declaredDurationMs?: number;
  /** Lower rank is more preferred (§16 selection priority dimension 6). */
  readonly policyPreferenceRank?: number;
};

/**
 * One requested render layer/binding declared by the caller for a Storyboard scene. The
 * v0.1 reference compiler does not derive bindings automatically from Storyboard semantic
 * intent (a documented simplification — see Known Limitations); callers declare which
 * scenes need which evidence bound into which layer role.
 */
export type RenderBindingRequest = {
  readonly id: string;
  readonly storyboardSceneId: string;
  readonly renderLayerId: string;
  readonly evidenceRefId: string;
  readonly role: "primary" | "supporting" | "background";
  readonly criticality: "required" | "optional";
  readonly acceptableMediaTypes: readonly RenderMediaType[];
  readonly geometry: { readonly xPx: number; readonly yPx: number; readonly widthPx: number; readonly heightPx: number };
  readonly zIndex: number;
};

export type RenderTextLayerRequest = {
  readonly id: string;
  readonly storyboardSceneId: string;
  readonly sourceField: "title" | "purpose";
  readonly geometry: { readonly xPx: number; readonly yPx: number; readonly widthPx: number; readonly heightPx: number };
  readonly zIndex: number;
  readonly criticality: "required" | "optional";
  readonly maxFontSizePx: number;
  readonly minFontSizePx: number;
  /** Closed immutable font token; defaults to dps-sans-regular-v1. */
  readonly fontToken?: "dps-sans-regular-v1" | "dps-sans-semibold-v1" | "dps-mono-regular-v1";
  readonly approvedVariants?: readonly ApprovedTextVariant[];
};

export type RenderCompilerBundle = {
  readonly input: RenderCompilerInput;
  readonly storyboard: Storyboard;
  readonly storyboardContentHash: string;
  readonly adapterCapabilities: AdapterCapabilities;
  readonly adapterCapabilitiesHash: string;
  readonly assetCandidates: readonly RenderAssetCandidateRecord[];
  readonly assetBindingRequests: readonly RenderBindingRequest[];
  readonly textLayerRequests: readonly RenderTextLayerRequest[];
  readonly overrides: readonly RenderOverrideRecord[];
};
