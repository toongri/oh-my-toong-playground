# ATTRIBUTION / NOTICE

This skill (`insane-browsing`) ships content derived from the
`fivetaku/insane-search` project (MIT) plus two third-party tools that it
installs at runtime (it does NOT vendor their source). Each source's license
and required notices are reproduced below.

---

## 1. insane-search (fivetaku) — upstream source

The `engine/` directory and related reference docs in this skill are derived
from `fivetaku/insane-search` (MIT), vendored at fork-point commit
`cac87e558767e979d2a458112a38e60c8ba629eb` (2026-04-22).

**Copy-chain provenance:** the vendor copy was obtained via the OMO
`ultimate-browsing` fork of `fivetaku/insane-search`. The Tier 3 stealth
Chromium integration and Tier 2 cookie layers are fork-added, not present in
the upstream `fivetaku/insane-search` repository. A future audit of those
layers should start from the OMO fork, not from `fivetaku/insane-search`
directly.

MIT License

Copyright (c) 2026 fivetaku

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 2. agent-browser (vercel-labs) — Tier 2 agent-reach CDP CLI (runtime dependency)

The Tier 2 automation CLI is **agent-browser**, installed at runtime via `npm`
(`npm i -g agent-browser`). No agent-browser source is vendored in this repository.

- Source: https://github.com/vercel-labs/agent-browser
- Pinned runtime version: **0.29.1** (documented in `references/chrome-stealth.md`;
  documented version string, no automated drift check).
- Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  these files except in compliance with the License. You may obtain a copy of the
  License at:

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed under
  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied. See the License for the specific language governing
  permissions and limitations under the License.

- **Changes (Apache-2.0 §4(b)):** none. agent-browser is installed unmodified at
  runtime; no agent-browser source file is copied, modified, or redistributed by this
  skill. This skill only documents how to invoke the upstream CLI.

- **NOTICE:** the upstream agent-browser distribution may include a `NOTICE` file. As
  this skill redistributes no agent-browser source, no upstream NOTICE content is
  bundled here; consult the upstream repository for its `NOTICE` file when present.

- **Trademark notice:** "agent-browser" and "Vercel" are referenced by name for
  identification only. No trademark license is granted under the Apache License 2.0
  (Section 6).

---

## 3. CloakBrowser (CloakHQ) — Tier 3 stealth Chromium (runtime dependency)

The Tier 3 stealth browser is **CloakBrowser**, installed at runtime via `pip`
(`pip install cloakbrowser`). No CloakBrowser source is vendored in this repository.

- Source: https://github.com/CloakHQ/CloakBrowser
- Pinned runtime version: **0.4.0** (documented in `references/chrome-stealth.md`;
  this is a documented version string, not an automated drift check).
- Wrapper source license: MIT License.
- Binary license: the compiled CloakBrowser Chromium binary downloaded by
  `cloakbrowser.ensure_binary()` is governed by the separate CloakBrowser
  Binary License:
  https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md
- Redistribution note: this skill does not redistribute the CloakBrowser
  binary, does not repackage it, and does not include it in `skills/` or
  `dist/skills`. Users who run the Tier 3 setup download the binary directly
  from CloakHQ's official distribution channels and must comply with that
  binary license.

MIT wrapper source license:

```
MIT License

Copyright (c) 2026 CloakHQ

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
