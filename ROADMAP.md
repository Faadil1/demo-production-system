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
- [ ] Story Engine
- [ ] Playwright browser adapter
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
