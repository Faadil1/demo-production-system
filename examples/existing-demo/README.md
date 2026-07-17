# Existing Demo Analysis example (RFC-0003)

This directory demonstrates `npm run analyze-demo` — the deterministic, local-only
analysis of an existing demo video described in
[`docs/005-existing-demo-analysis.md`](../../docs/005-existing-demo-analysis.md).

## Files

- `analysis.yaml` — the analysis input: a `MediaSource` pointing at `./demo.mp4`, a
  `goal`, a `transcript`, and an `observationTimeline`.

No video file is committed to this repository (RFC-0003 explicitly forbids committing
binary video).

## Running it as-is

```bash
npm run analyze-demo -- examples/existing-demo/analysis.yaml
```

Because `./demo.mp4` does not exist, `ffprobe` cannot inspect it. The CLI does **not**
fake a successful inspection: `media-inspection.json` will report
`status: "invalid"` with issue `file-missing`, and `existing-demo-analysis.json` will
report `gate.status: "fail"` (blocking reason: media could not be inspected). The
command exits with a non-zero status code. This is the correct, honest behavior for a
missing source file — not a bug.

## Running it against a real video

1. Place any local video file at `examples/existing-demo/demo.mp4` (or edit
   `source.uri` in `analysis.yaml` to point elsewhere).
2. Re-run the command above.
3. If `ffprobe` is installed and the file is valid, `media-inspection.json` will report
   `status: "inspected"` with real container/stream metadata, and the gate will resolve
   based on the supplied `transcript`/`observationTimeline` and the rules in
   `docs/005-existing-demo-analysis.md`. With the fixture data as shipped, the expected
   outcome is `gate.status: "conditional"` (the Hero Interaction is identified, but its
   supporting `result-visible` observation is unverified, so verified visual proof is
   absent).

## Inspecting output

Artifacts are written to `.dps/runs/<run-id>/`:

- `source.json`
- `media-inspection.json`
- `transcript.json`
- `observations.json`
- `existing-demo-analysis.json`
- `decisions.json`
- `events.json`
- `run-summary.json`
