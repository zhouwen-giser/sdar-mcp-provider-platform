# Task Index

- `G3-P0-B01` — Lock Goal 03 baseline and isolate first failures (P0; deps: none)
- `G3-P1-B01` — Restore Docker workspace build and compose health (P1; deps: G3-P0-B01)
- `G3-P1-B02` — Restore verify:v2 without weakening gates (P1; deps: G3-P0-B01)
- `G3-P1-B03` — Add PMS API production CI qualification job (P1; deps: G3-P1-B01, G3-P1-B02)
- `G3-P2-B01` — Consolidate RuntimeDeployment reconcile job type (P2; deps: G3-P0-B01)
- `G3-P2-B02` — Repair RuntimeDeployment state convergence (P2; deps: G3-P2-B01)
- `G3-P3-B01` — Run Goal 03 acceptance and prepare handoff (P3; deps: G3-P1-B03, G3-P2-B02)
