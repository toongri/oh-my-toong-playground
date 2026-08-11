# Toolchain via mise

`mise.toml` — in the repo or in a directory above it — is the toolchain source
of truth for the tools it declares. Don't install around it or hardcode a
runtime path; add the missing version there. `mise ls --current` prints what
actually resolves in the current directory.

A system stub answering instead of the pinned version (`/usr/bin/java` saying
"Unable to locate a Java Runtime", a `node` that disagrees with the pin) is a
resolution failure, not a missing install — `mise activate` hooks only fire in
interactive shells. Run it through `mise exec -- <command>`, which also injects
`JAVA_HOME`. If the pinned tool is still unreachable, the config is untrusted:
mise hard-errors there and the command never runs, so `mise trust <path>`.
