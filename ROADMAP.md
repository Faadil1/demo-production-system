# Roadmap

## v0.1 — Foundation

- [x] Constitution
- [x] Core type contracts
- [x] Artifact envelope
- [x] Decision records
- [x] Event bus interface
- [x] Initial DIR
- [x] `demo.yaml` JSON Schema
- [x] Contract-test skeleton
- [x] First reference engine
- [x] Filesystem artifact registry
- [x] CLI validation command

## v0.2 — Functional MVP

- [x] Understanding Engine (RFC-0002 Product Understanding Contract)
- [x] Planning Engine (consumes Product Understanding Gate + selection)
- [x] Story Engine implemented with explicitly documented limitations (RFC-0005 — contracts, deterministic compiler, `compile-story` CLI; independently audited — see `docs/implementation/rfc-0005-conformance-audit.md` and `docs/implementation/rfc-0005-implementation.md`. Candidate generation reaches 9 of 19 `NarrativeBeatKind`s, which in turn makes 4 of 8 `NarrativeArc`s unreachable without an explicit `arc-override`; proof-chain evidence is bounded by DIR evidence `kind` rather than true per-claim linkage, pending an upstream RFC-0004/DIR owner decision on adding a claim↔assertion identifier)
- [x] Playwright browser adapter (RFC-0004 Browser Evidence Capture — reference implementation complete; extension adapters pending)
- [x] Render Gate implemented with explicitly documented limitations (RFC-0006 — renderer-neutral Render Plan compiler, deterministic frame quantization, asset resolution/integrity, objective layout/capability constraints, and one technical Render Gate; `compile-render` CLI; independently audited — see `docs/implementation/rfc-0006-conformance-audit.md` and `docs/implementation/rfc-0006-implementation.md`. Asset preparation is a deterministic mock pass-through (no real pixel/video transform); media-type detection is magic-byte sniffing, not full codec decoding; text measurement is a deterministic synthetic model, not real font metrics; binding derivation is caller-declared rather than auto-derived from Storyboard semantic intent)
- [ ] Remotion renderer adapter
- [ ] MP4 export
- [ ] One end-to-end example

## Existing Demo Analysis (RFC-0003)

- [x] Media source contracts (local-video / youtube-url / remote-url)
- [x] Deterministic local ffprobe-based media inspection
- [x] Transcript and observation-timeline contracts
- [x] Existing Demo Analysis domain model + deterministic reference engine
- [x] Hero Interaction detection over supplied observations
- [x] Demo Score (100-point, explainable) and Analysis Gate
- [x] `analyze-demo` CLI command
- [ ] YouTube ingestion adapter
- [ ] Speech-to-text adapter
- [ ] Scene/frame extraction + visual observation adapter
- [ ] OCR adapter

## Browser Evidence Capture (RFC-0004)

Status: Reference implementation complete. Extension adapters pending.

- [x] Browser target and capture-plan contracts, safety policy
- [x] Replaceable `BrowserAdapter` interface + Playwright Chromium reference implementation
- [x] Deterministic action execution, assertions, screenshot + sanitized DOM snapshot capture
- [x] Network interception/recording with sensitive-data redaction
- [x] Browser-generated `DemoObservationTimeline` (RFC-0003-compatible)
- [x] Evidence manifest, Capture Gate
- [x] `BrowserCaptureEngine` (pure domain logic, testable without a real browser)
- [x] `capture-browser` CLI command
- [x] One-way bridge from verified capture evidence into RFC-0002 `EvidenceItem`s
- [ ] Browser exploration agent
- [ ] Authenticated session adapter
- [ ] Visual comparison / OCR / accessibility-tree analysis adapters
- [ ] Video/trace recording, remote browser adapter

## v0.5 — Intelligent Demo

- [x] Hero Interaction Detector (existing-demo analysis; forward-planning detector remains RFC-0002's manifest-hint policy)
- [x] Evidence coverage analysis (existing-demo analysis; forward-planning coverage remains RFC-0002)
- [x] Demo Score (existing-demo analysis)
- [ ] Critic Engine
- [ ] Decision Replay
- [ ] Motion Authenticity Gate

## v1.0 — Platform

- Stable plugin SDK
- Portable Demo Packs
- Multi-renderer support
- Studio UI
- Public adapter documentation
