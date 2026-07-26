# Decisions

## 2026-07-26 — G1-P3-B09 root command wiring

The task requires `pnpm config:schema:generate` and `pnpm config:schema:check`, but neither
root command exists. Add only these two script entries to the root `package.json`, pointing at the
generator under the card's allowed `scripts/**` range. This is the minimum out-of-range change
needed to make the mandatory verification reproducible; it adds no dependency or future capability.
