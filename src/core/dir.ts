import type { VerificationStatus } from "./provenance.js";

export type SceneIntent =
  | "explain"
  | "reveal"
  | "compare"
  | "prove"
  | "guide"
  | "transform"
  | "confirm"
  | "warn"
  | "invite";

export type EvidenceReference = {
  readonly id: string;
  readonly kind:
    | "capture"
    | "recording"
    | "receipt"
    | "log"
    | "metric"
    | "document"
    | "state-change";
  readonly claim: string;
  readonly source: string;
  readonly importance: "supporting" | "important" | "critical";
  readonly verificationStatus: VerificationStatus;
};

export type DIRReadiness = "ready" | "conditional" | "blocked";

export type DIRScene = {
  readonly id: string;
  readonly actId: string;
  readonly purpose: string;
  readonly intent: SceneIntent;
  readonly durationSeconds: number;
  readonly evidenceIds: readonly string[];
  readonly isHeroInteraction: boolean;
  readonly transitionRelation:
    | "cause"
    | "contrast"
    | "continuation"
    | "resolution"
    | "escalation"
    | "opening"
    | "closing";
};

export type DIRAct = {
  readonly id: string;
  readonly purpose: string;
  readonly sceneIds: readonly string[];
};

export type DemoIntermediateRepresentation = {
  readonly schemaVersion: "0.2";
  readonly title: string;
  readonly goal: "explain" | "convince" | "prove" | "onboard";
  readonly audience: string;
  readonly durationSeconds: number;
  readonly heroInteractionSceneId: string;
  readonly acts: readonly DIRAct[];
  readonly scenes: readonly DIRScene[];
  readonly evidence: readonly EvidenceReference[];
  readonly constraints: {
    readonly noGeneratedUI: boolean;
    readonly minimumEvidenceCount: number;
    readonly maximumOnScreenWords: number;
  };
  readonly readiness: DIRReadiness;
};
