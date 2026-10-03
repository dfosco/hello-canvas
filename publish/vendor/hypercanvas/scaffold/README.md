# Storyboard

> Note: this is a scaffold-source README. The file copied to client repos
> only contains the fragment bodies — the bare `<!-- … --start-->` markers
> below are stripped on whole-file copy. Clients can also adopt individual
> fragments by adding `<!-- storyboard:scaffold/README.md:<id> --start-->`
> markers around their own content.

<!-- hypercanvas-cli --start-->
## Hypercanvas CLI

Install the latest macOS Apple silicon release with the [GitHub Release bootstrap](https://github.com/dfosco/hypercanvas/releases/latest/download/hypercanvas-install.sh):

```bash
curl -fsSL https://github.com/dfosco/hypercanvas/releases/latest/download/hypercanvas-install.sh | sh
hypercanvas
```

The Rust/Ratatui wrapper installs the supported Node 24 LTS runtime in the user account if needed, then opens Hypercanvas in the normal browser. Keep the TUI open while using the app; quitting it stops the Core server. Node and user-selected agent CLIs are installed dependencies, not bundled executables. Paseo's SDK, daemon, and PTY dependency closure are bundled.

The existing `storybook <command>` CLI remains the operational developer/agent interface. To manage agent CLI installation from a separate terminal, keep Hypercanvas running and use:

| Command | Purpose |
|---|---|
| `storybook host-tools preflight` | Inspect system Node/npm and selected agent CLIs. |
| `storybook host-tools plan --agents codex,claude` | Create an exact, non-mutating setup plan. The `--agents` flag may repeat, or IDs may be comma-separated. |
| `storybook host-tools install --plan <id> --consent` | Explicitly consent to and start that plan. |
| `storybook host-tools status --operation <id>` | Read operation progress and results. |
| `storybook host-tools cancel --operation <id>` | Request cancellation when the current phase allows it. |

These commands use the running Core's branch-aware route and print JSON. Installation does not authenticate an agent; sign-in remains a separate action inside the installed CLI. See the [Hypercanvas installation and recovery guide](https://github.com/dfosco/hypercanvas/blob/main/DOCS/hypercanvas-install.md).

Notebook lifecycle and Core OS picker API routes have the corresponding `storybook notebook recent/open/create/close` and `storybook system select-directory|select-file` CLI clients.
<!-- hypercanvas-cli --end-->
