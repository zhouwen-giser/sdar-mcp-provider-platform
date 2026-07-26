# Phase R2 Known Issues

The local account cannot access Docker/PostgreSQL. R2's real database and Compose gates run in GitHub Actions and must pass before R3 starts.

Task publication, lifecycle persistence and Tasks methods are R3 scope. R2 rejects nonterminal accepted execution instead of creating an unpersisted or memory-only Task.
