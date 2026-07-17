# RFC-0001 — Foundation Vertical Slice

## Status

Accepted for implementation.

## Goal

Prove that DPS can transform a validated `demo.yaml` document into inspectable, versioned artifacts without depending on browser automation, an LLM, or a renderer.

## Scope

1. Parse and validate `demo.yaml`.
2. Run a deterministic reference Understanding Engine.
3. Run a deterministic reference Planning Engine.
4. Compile a minimal DIR.
5. Store artifacts in a filesystem registry.
6. Emit lifecycle events.
7. Record decisions.
8. Produce a machine-readable run summary.

## Explicitly excluded

- Chrome control;
- screen recording;
- Remotion;
- voice;
- generated B-roll;
- automatic metaphor selection;
- cloud services.

## Acceptance criteria

- Invalid configuration fails before engine execution.
- Every artifact includes ID, schema version, producer, timestamp, dependency IDs, and content hash.
- Re-running with identical inputs yields semantically equivalent outputs.
- The DIR references at least one Hero Interaction candidate and one evidence requirement.
- Contract tests run without network access.
