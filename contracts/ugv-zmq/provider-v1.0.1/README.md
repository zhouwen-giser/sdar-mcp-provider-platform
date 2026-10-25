# Native Provider public catalog 1.0.1

Profile: `zmq_v1_0_1_12`; Provider implementation version: `1.0.1`.

Frozen Runtime reserves the root result keys `outcome`, `reasonCode`, `retryable` and `completedAt`.
The public success schemas now describe its actual wire result. Internal native DTO validation
remains strict and retains the original fields in Provider storage and Context/history. Nested
historical records are unchanged. The Runtime business-failure alternative remains published.

The original `provider-v1/catalog.json` is retained as historical 1.0.0 input. Do not overwrite it
or silently republish an existing SDAR Skill under this changed public Schema. Provider, console
and SDAR current pins must match the complete twelve-tool 1.0.1 catalog before admission.

Regression: formal PostgreSQL test validates strict internal DTOs, public inspection results,
scheduled revision-zero binding, TaskBusiness reads and confirmed remote cancellation. The joint
SDAR chain uses its actual frozen MCP SDK output validation. This patch does not qualify G0 or
authorize a 19100/19101 cutover.
