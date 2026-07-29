# Task Index

- `G4-P0-B01` — Lock Goal 04 baseline and validate Goal 03 handoff (P0; deps: none)
- `G4-P1-B01` — Pin PM2 and implement production JavaScript API bridge (P1; deps: G4-P0-B01)
- `G4-P1-B02` — Enforce PM2 configuration drift and product-path real E2E (P1; deps: G4-P1-B01)
- `G4-P2-B01` — Harden PMS Worker runtime configuration and composition contracts (P2; deps: G4-P0-B01)
- `G4-P2-B02` — Add periodic reconcile scheduler with database-backed deduplication (P2; deps: G4-P2-B01)
- `G4-P2-B03` — Assemble PMS Worker production runtime lifecycle (P2; deps: G4-P1-B02, G4-P2-B02)
- `G4-P3-B01` — Prove Worker-to-Runtime production lifecycle end to end (P3; deps: G4-P2-B03)
- `G4-P3-B02` — Add final platform CI qualification jobs (P3; deps: G4-P3-B01)
- `G4-P4-B01` — Finalize version, release evidence and review-ready handoff (P4; deps: G4-P3-B02)
