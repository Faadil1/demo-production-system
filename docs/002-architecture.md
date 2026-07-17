# Architecture

```text
Project Inputs
      |
      v
Understanding Engine
      |
      v
Planning Engine
      |
      v
Demo Intermediate Representation
      |
      +--> Capture Engine --> Browser Adapter
      +--> Story Engine
      +--> Motion Engine
      +--> Audio Engine
      +--> Render Engine --> Renderer Adapter
      +--> QA Engine
      +--> Critic Engine
```

## Core boundary

The core owns:

- domain types;
- engine contracts;
- artifact registry contracts;
- event contracts;
- decisions;
- DIR validation;
- pipeline orchestration semantics.

Adapters own:

- browsers;
- renderers;
- TTS;
- video generation providers;
- file storage implementations;
- model providers.

## Architectural constraint

No core module may import an adapter implementation.
