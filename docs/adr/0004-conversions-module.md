# ADR 0004 — Dedicated `packages/conversions` module with property-based tests

- **Status:** Accepted
- **Date:** 2026-04-17
- **Traces to:** Plan AD-4, design-review recommendation

## Context

Recipe plated-cost depends on exact unit conversions across weight, volume, and count (with
ingredient-specific density). Ad-hoc conversion helpers scattered through services are a known
footgun: every recipe engine that has shipped without a unified conversion layer has later
discovered silent rounding bugs or missing-density crashes deep in cost reports.

## Decision

All conversion logic lives in `packages/conversions` — a pure, dependency-free TypeScript package.
API shape:

```ts
convert(qty, fromUnit, toUnit, { densityGPerMl?, utensilId? }) → Result<qty>
```

Tests are property-based (`fast-check`). Invariants:
- weight↔weight and volume↔volume roundtrip within 1 ULP.
- volume↔weight requires density; missing density throws `ConversionError('missing_density')`.
- utensil chain honours per-ingredient overrides over the default set (spec §6.3a AC-3/4).

## Alternatives considered

- **Inline helpers per service:** Rejected — drift + duplication guaranteed.
- **Third-party `convert-units`:** Rejected — no first-class density or utensil support; wrapping it
  would hide the primary business rules.

## Consequences

- + Conversion bugs caught at the package boundary, not in UI.
- + `services/ml` reuses the same package (via node-subprocess or a JSON-rule export) so ML features
  and reports agree on numbers.
- − `services/ml` (Python) cannot import the TS package directly; export a static JSON ruleset on
  build to keep parity.
