# Workspace hygiene

These rules apply to every task in this repository.

1. Keep durable product files only: source, tests, configuration, lockfiles, maintained documentation, design references, and the current release artifact.
2. Put one-off diagnostics, screenshots, logs, downloaded archives, and intermediate scripts in the system temporary directory. If a task must create them in the repository, remove them before handoff.
3. Do not leave build output, dependency directories, caches, generated Tauri files, TypeScript build metadata, or superseded installers after a task is complete.
4. Before the final response, run the relevant tests, then run `npm run clean:workspace`. Confirm with `git status --short --ignored` that only intentional files remain.
5. A script may remain under `scripts/` only when it is a documented, reusable project command. Delete task-specific helper scripts after their result has been incorporated.
6. Never delete user-imported health exports, application databases, the current installer, release checksums, or an unfamiliar file merely because it is untracked. Investigate first.

`scripts/clean-workspace.mjs` is the canonical cleanup command. Run `node scripts/clean-workspace.mjs` to preview its targets.
