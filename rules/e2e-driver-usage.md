# E2E Driver Usage

Route end-to-end interaction by the surface being driven:

| Surface | Driver | Required skill |
| --- | --- | --- |
| Web pages, browser pages, and Electron desktop apps | `agent-browser` | `agent-browser` |
| iOS, tvOS, macOS, Android, and Amazon Vega OS TV apps | `agent-device` | `agent-device` |
| APIs | `curl` | — |
| CLI or TUI programs | `bash` | — |

Electron apps use `agent-browser`, not `agent-device`. Native desktop apps are
supported only on macOS via `agent-device`. There is no supported driver for
Windows or Linux native desktop apps, or for TV platforms outside tvOS and
Vega OS — do not route those to `agent-device`; stop and tell the user
instead.

Before issuing any `agent-browser` or `agent-device` CLI command, load the
matching skill via the Skill tool first. Use the commands and options documented
by that skill or its runtime guidance; never guess them.
