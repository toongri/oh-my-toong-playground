# E2E Driver Usage

Route end-to-end interaction by the surface being driven:

| Surface | Driver | Required skill |
| --- | --- | --- |
| Web pages, browser pages, and Electron desktop apps | `agent-browser` | `agent-browser` |
| iOS, Android, mobile, TV, and native desktop apps | `agent-device` | `agent-device` |
| APIs | `curl` | — |
| CLI or TUI programs | `bash` | — |

Electron apps use `agent-browser`, not `agent-device`. Native desktop apps use
`agent-device`.

Before issuing any `agent-browser` or `agent-device` CLI command, load the
matching skill via the Skill tool first. Use the commands and options documented
by that skill or its runtime guidance; never guess them.
