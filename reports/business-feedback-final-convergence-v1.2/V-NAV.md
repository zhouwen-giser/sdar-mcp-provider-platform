# V-NAV — real public navigation passed

Task `8a3d2d0b-5cf7-4e07-96a8-193b3cad6267` ran through the production Runtime
and Provider entrypoints, the existing airport road planner, the actual software
simulator, and a disposable complete GOWM SMPP installation under its application
role. This is the same recorded run as V-EDIT, not a new execution.

For missions 47564, 47565 and 47566, the public snapshots contain separate
`navigation.route` candidate revision 1 and adopted revision 2. Each pair has
identical planner geometry and the corresponding mission relation. Actual GNSS
trajectory objects remain separate observed artifacts. The final effective plan
is revision 3; the public Task is completed and its Context is finalized.

The result names mission 47566 and destination 106.81312856, 29.72041222. Measured
remaining distance is 1.454523 m, speed is zero, and stationarity is confirmed.
Runtime and Provider restarted between adjustments without adding mutations.
Public SSE applied 15 initial and 39 recovered-window events.

See [structured results](V-NAV.json), the original
[public run](evidence/navigation-public-restart.json), and the
[consumer sample manifest](evidence/navigation-public-handoff/manifest.json).
The sample manifest pins the source report, unchanged candidate source fingerprint,
and all six NDJSON files. Those files preserve captured probe records and exact
object versions; they are not reconstructed raw SSE or complete Context envelopes.

This passes the local real navigation workflow. It does not qualify V-OBS,
V-INPUT, external SDAR, a remote deployment, or the whole Goal.
