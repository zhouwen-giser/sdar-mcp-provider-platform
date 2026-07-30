# Goal 05 Runtime credential isolation matrix

Goal 05 qualifies the V0.1 file-backed control-plane credential boundary with two real
Provider/Deployment/Instance lifecycles. Each Runtime receives only its own `control-plane.token`
path through the PM2 bootstrap; token contents are never copied into environment variables,
evidence, diagnostics, or database state.

| Qualification case     | Identity A                | Identity B           | Required result                                              |
| ---------------------- | ------------------------- | -------------------- | ------------------------------------------------------------ |
| Credential resolution  | A path                    | B path               | Distinct canonical files under the private credential root   |
| Missing credential     | Present                   | Missing              | B has no PM2 process and cannot become `ACTIVE`              |
| Full convergence       | A token                   | B token              | Both reach `ACTIVE` with independent databases and PM2 names |
| Config pull            | A token targets B         | B token targets A    | Both return `403`                                            |
| Config watch           | A token targets B         | B token targets A    | Both return `403`                                            |
| Config acknowledgement | A token targets B         | B token targets A    | Both return `403`                                            |
| Runtime registration   | A token targets B         | B token targets A    | Both return `403`                                            |
| Runtime heartbeat      | A token targets B         | B token targets A    | Both return `403`                                            |
| API and Worker restart | Reload both mappings      | Reload both mappings | Both identities return to or remain `ACTIVE`                 |
| Peer crash             | A is killed and recovered | B remains online     | B PID and restart count are unchanged                        |
| Token rotation         | A token is replaced       | B token is unchanged | A recovers; B PID and restart count are unchanged            |

The gate uses real local PostgreSQL, the repository-pinned PM2 JavaScript API, the built Runtime
release, and built mock Provider Adapters. This is a controlled production-path qualification, not
real-provider certification. Evidence records boolean assertions and public component versions,
without token content, token paths, hashes, or reversible fingerprints.
