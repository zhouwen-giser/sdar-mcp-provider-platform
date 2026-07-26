# Phase R8 Known Issues

- The JSON reference stores are intentionally single-process Adapter stores; resource teams may replace them with their transactional business database while preserving the same taskId/argument/context/command bindings.
- Local Python has no pip and the Docker socket is unavailable; Actions run
  `29499994468` passed the corresponding Python, PostgreSQL and Docker gates.
- R9 folds the machine reports into the final release evidence and adds deployment/upgrade/audit/capacity deliverables.
