---
name: create-slides
description: Generates single-file HTML presentations with vertical scrolling and scroll-snap. Uses plain HTML+CSS without slide libraries and supports dark/light themes, frontend-design skill integration, and highlight.js·Mermaid·KaTeX·Chart.js·Iconify CDNs.  Triggers: "make a presentation", "create slides", "build a deck", "발표자료", "프레젠테이션", "슬라이드", "제안서", "발표 만들어", "ppt", "keynote", "pitch deck", "tech talk", "발표 만들어줘".
---

# Scrollytelling Presentation Generator

## Philosophy

This skill does not use slide libraries such as reveal.js.
Instead, it uses **storytelling through vertical scrolling**.

Core principles:

- **Single HTML file**: All CSS inline in `<style>`; only minimal JS allowed
- **100vh sections**: Each section fills the screen, with natural scrolling between sections
- **Content first**: Achieve a clean presentation through typography and spacing instead of elaborate animations
- **Design system based**: Use consistent components and color palettes

Quality bar: The polish of a landing page made by a Korean design agency.

---

## Workflow

### Step 0: Understand the Content

Analyze the user's input first. Input can take various forms:

- Detailed outline/body → Structure it directly
- Topic only ("AI 에이전트에 대한 발표") → Propose an outline with an appropriate number of sections and get confirmation
- Existing documents/notes → Extract key messages and convert them into a slide structure

### Step 1: User Confirmation (Required)

After analyzing the content, **you must propose all the following items together using AskUserQuestion and obtain user confirmation.**
**This procedure cannot be skipped.** Present the AI's inferred choices, but the user makes the final decision.
The question may be skipped only if the user already specified every item in the request (e.g., "다크 + frontend-design + 8장으로").

**Items to propose:**

1. **Theme**: Dark or Light (include a recommendation rationale based on the content)
2. **Design style**: frontend-design / 자체 심플 / 직접 제공
3. **Slide structure**: Propose each slide's title and type as a numbered list
4. **Accent colors**: Propose a combination of 2–3 colors suited to the content (include hex codes)

**Example proposal:**
```
발표 내용을 분석했습니다. 아래 구성으로 진행할까요?

■ 테마: Dark (권장) — 기술 주제라 어두운 배경이 적합합니다
■ 디자인: /frontend-design (기본값) — 화려한 비주얼
■ 악센트 컬러: #00d2ff (cyan) + #7b2ff7 (purple) + #ff6b6b (coral)

■ 슬라이드 구성 (5장):
  1. [title] Kotlin 소개
  2. [content] Kotlin이란?
  3. [card-grid] 주요 특징 4가지
  4. [code] 코드 예시 — data class, coroutine
  5. [closing] 마무리

수정하고 싶은 부분이 있으면 알려주세요.
엔터만 누르면 위 구성으로 진행합니다.
```

**Theme recommendation criteria:**
- **Recommend Dark**: Technical presentations, development stories, hackathons, live coding, architecture explanations
- **Recommend Light**: Planning proposals, business strategy, product introductions, educational materials

### Step 2: Load the Design Source

Load according to the design style the user confirmed:

| Choice       | Design source                                       | Characteristics                                              |
| ---------- | ------------------------------------------------- | ------------------------------------------------- |
| frontend-design (default) | frontend-design skill                  | Elaborate, creative visuals (glassmorphism, glow, etc.) |
| 자체 심플  | `references/design-system.md` (built-in design system) | Consistent, restrained minimal style |
| 직접 제공  | User-provided guide                                | Custom user style                                |

> **자체 심플 — missing file:** If `references/design-system.md` is missing, proceed using only this skill's CSS rules and font fallback, and inform the user.

**How to load frontend-design:**
1. If the `/frontend-design` skill is installed on the system, invoke it.
2. If it is not installed, retrieve SKILL.md from the URL below using WebFetch and use it as guidance:
   `https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/frontend-design/SKILL.md`

**Boundary rules when using frontend-design:**
Borrow only the frontend-design skill's **colors, gradients, glassmorphism, and texture styles**.
For layout structure (100vh sections, scroll-snap), fonts (@font-face NanumSquareNeo), and JS limits, **this skill's rules take precedence**.

**Common rules retained for every choice:**
- Single HTML file output
- Page-by-page scrolling with `scroll-snap-type: y mandatory` + `height: 100vh`
- NanumSquareNeo font (@font-face)
- highlight.js CDN (when code blocks are included)

**When using a user-provided guide:**
- If the user provides a design guide as a URL, file, or text, apply that guidance first.
- Keep the common rules above unchanged.

### Step 3: Plan the Slide Outline

First write a **detailed slide outline** based on the slide structure the user confirmed in Step 1.
Design each slide's actual content elements in detail at this stage to ensure consistency and quality when writing the HTML later.

**Outline storage (use judgment based on length):**
- **10 slides or fewer**: Manage in memory (within the conversation context)
- **11 slides or more**: Write a temporary Markdown file (`{title-slug}-outline.md`) for reference. Delete it after completing the HTML

**Outline format** — Specify the following for every slide:

```markdown
## Slide {N}: {title} [{type}]

- **Label**: {section category text}
- **Heading**: {key message}
- **Content**: {body summary or list of items}
- **Visual**: {components to use — 3 stat-boxes, 4 cards, code block, etc.}
    - Diagram type selection criteria:

      | Condition | Type to use |
      |------|---------|
      | sequence / request-response flow | Mermaid (`sequenceDiagram`) |
      | flowchart / branches / if-else | Mermaid (`flowchart LR`) |
      | ER / table relationships / DB schema | Mermaid (`erDiagram`) |
      | gantt / schedule / roadmap | Mermaid (`gantt`) |
      | Architecture with 4 or more nodes | Mermaid (`flowchart`) |
      | Simple component relationships, **≤3 nodes**, slide theme colors needed | Inline SVG (`diagram` type) |

    - `diagram` type (Inline SVG): `viewBox="0 0 600 {height}"` — Only for 3 nodes or fewer. Nodes (`<g class="diag-node">`), edges (`<line class="diag-edge">`), and `<defs>` markers. Reference CSS variables for fill/stroke. **Marker ids must be unique per slide** (e.g., `id="diag-arrow-s5"`) — Prevent duplicate ids when Mermaid/multiple diagram slides coexist.
    - `flow` 5-step variant: `.workflow-grid` grid + `.wf-step::after` arrows. No `.flow-arrow` div needed.
    - `title` hero badges: `.hero-badge-row` + `.hero-badge`. Show 3–4 key points with dots + text, without Iconify.
- **Notes**: {special considerations — whether min-height is needed, CDN libraries, overflow switching, etc.}
```

**Structure guidelines:**
- If there are 5 content items or fewer, 5–7 sections are enough. Do not inflate the count.
- For more than 15 slides, add a table-of-contents section and divide chapters with PART dividers.
- Structure pattern: `title → context/problem → solution → details(2–4 slides) → evidence → next-steps → closing`

### Step 4: Write the HTML Skeleton

Once the outline is finalized, **Write only the HTML skeleton (Head + CSS) first**.
Do not put slide content inside `<body>` at this stage.

**Skeleton structure created with Write:**

```html
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{presentation title}</title>
    {highlight.js CSS CDN link — only when code blocks are present}
    {Other required CDN CSS — KaTeX, etc.}
    <style>
      {Complete NanumSquareNeo @font-face blocks}
      {CSS variables — :root theme definition}
      {Overall layout CSS — scroll-snap, shared .slide styles, page number counter}
      {CSS for every slide type — slide--title, slide--content, slide--card-grid, etc.}
      {Responsive @media queries}
    </style>
  </head>
  <body>

  {CDN scripts — only those needed, such as highlight.js and Mermaid}
  <script>
    hljs.highlightAll();
  </script>
  </body>
</html>
```

**Key point**: Include styles for **all slide types specified in the outline at once** in the CSS.
Design it so that appending slides later requires no further CSS edits.

### Step 5: Append Slides

Once the skeleton is ready, **use the Edit tool to append slides sequentially just before `</body>`**.
Add them in appropriate batches rather than writing everything at once.

**Append batches (use judgment):**
- **Default**: Add 1–3 slides per Edit
- **Simple slides** (title, closing, quote, etc.): May group 2–3 together
- **Complex slides** (code 30+ lines, card-grid 4+ cards, timeline 5+ stages): Add one at a time
- **Simple presentation with 10 slides or fewer in total**: May add all at once

**How to append:**

In each Edit, use the `</body>` tag or the blank line just before the CDN `<script>` block as `old_string`,
and insert `<section>` blocks at that position.

```
Edit:
  old_string: "{previous slide's closing </section> tag or last content in body}"
  new_string: "{previous content}\n\n    {new <section> blocks}"
```

**Give the user brief progress updates while working:**
- A short status update such as `"슬라이드 1-3/8 추가 중..."`

### Step 6: Finish and Check the File

After all slides have been appended:

1. Check that the slide count in the final HTML file matches the outline
2. Verify that the page counter total (`/ {N}`) matches the actual slide count
3. Delete the temporary outline file if one exists

### Step 7: Gemini Design Review (Optional)

Invoke the `slides-review` skill to improve the HTML design.
If the gemini CLI is not installed, it automatically performs a quiet pass, so no separate branch is needed.

**How to invoke:**

Pass the following context to the `slides-review` skill:
- **HTML file path**: Absolute path to the HTML file just created
- **Protection rules**: `scroll-snap 보호`, `폰트 보호: NanumSquareNeo`, `레이아웃 보호: 100vh`

If the skill applies guidance, summarize the result for the user; if skipped, proceed to the next step without a message.

### Step 8: Final Guidance

Tell the user the save path: `현재 디렉토리에 {title-slug}.html로 저장했습니다.`

---

## Slide Type Catalog

Each section uses one of the types below. A presentation may repeat the same type.
Use the **matching hints** to select a type suited to the content.

| Type         | Purpose          | Key elements                                     | Matching hints                            |
| ------------ | ------------- | --------------------------------------------- | ------------------------------------ |
| `title`      | Cover slide | Gradient text title, badge/eyebrow, subtitle | First slide, part divider           |
| `content`    | General content     | label + heading + desc body                   | Slides centered on explanation/narration          |
| `stat-grid`  | Emphasize numbers     | 2–4 stat-boxes (large number + label)             | Two or more figures, KPIs, or results |
| `card-grid`  | List items     | 2–4 cards (icon + title + description)           | Parallel items, feature lists, benefits    |
| `code`       | Explain code     | heading + highlight.js code block + explanation       | Code examples, CLI commands, configuration files       |
| `timeline`   | Stages/schedule     | Vertical timeline (dot + title + desc)            | Clear chronological/stage ordering       |
| `flow`       | Process      | Horizontal flow diagram (step + arrow)         | Pipelines, workflows, data flow  |
| `quote`      | Quote/emphasis     | quote-box (left border + text + source)         | Key message emphasis, user testimonials, quotations  |
| `comparison` | Comparison          | Two-column comparison (before/after, A/B)                  | Contrasting structures such as "기존 vs 신규", "A vs B"   |
| `naming`     | Name/formula     | naming-box (chip + result + explanation)               | Branding, compound-word explanations, formulas/equations       |
| `code-comparison` | Code comparison | Two-column code blocks (language/version/before-and-after comparison)          | "JS vs TS", "before/after", syntax comparison |
| `closing`    | Closing        | CTA button, thank-you message, contact information                 | Last slide, Q&A                 |
| `diagram`    | SVG architecture diagram | Inline SVG (`<rect>` + `<path>` + `<marker>` + CSS variable references) | Component relationships, data flow — when a theme-aware diagram is needed without JS |

> **`flow` 5-step variant**: For exactly 5 steps, `.workflow-grid` + `::after` arrows are recommended. No `.flow-arrow` div needed. See section 5 of `design-system.md`.

---

## HTML Structure Rules

1. **Single file**: No external CSS files. All styles inside `<style>` tags
2. **CSS variables**: Define theme variables in `:root` and reference them in components
3. **Section structure**: Use `<section class="slide slide--{type}">` consistently regardless of theme. Handle theme differences only through CSS variables and body classes
4. **Page-by-page scrolling**: `html { scroll-snap-type: y mandatory; }` + `scroll-snap-align: start;` on each section
5. **Section height**: Default to `height: 100vh` + `overflow: hidden`. For content-heavy sections (5 or more cards, 30 or more code lines, 5 or more timeline stages), switch to `min-height: 100vh` + `overflow: visible`. Retain `scroll-snap-align`
6. **Content width**: Default text `max-width: 720px`. Multi-column layouts such as card grids, comparisons, and flows may use up to `max-width: 960px`
7. **NanumSquareNeo font**: Declare directly using `@font-face` blocks. If loading the font URL fails, use `'Noto Sans KR', -apple-system, sans-serif` as fallback. 8. **Responsive**: Include the `@media (max-width: 768px)` breakpoint 9. **Page numbers**: Automatically display page numbers with a CSS counter. Must use `position: absolute` (`position: fixed` is prohibited — fixed causes all slide numbers to overlap, leaving only the last number visible). **You must open `references/code-snippets.md` and copy the font declarations and page-number CSS implementation** (do not write them yourself).

10. **Accessibility**: Set `<html lang="ko|en">`. Maintain WCAG AA or better color contrast. Use heading levels in `h1` → `h2` → `h3` order
11. **Inline elements in flex containers**: When inline elements such as `.hero-badge-row`, badge, tag, or pill are direct children of a flex column container, you must add `align-self: center; width: fit-content;`. Omitting this causes them to stretch to full width

---

## Typography & Color

### Shared Baseline Scale

The following values are the minimum baseline for **all design paths** (자체 심플, frontend-design, 직접 제공).
The AI must use these values as a **lower bound**, but may increase them based on content density and slide composition.
Do not set them **smaller** than these values.

**Look up baseline scale values in `references/code-snippets.md`** (do not write them from memory — values may change).

**Three-level hierarchy** — Apply consistently to all sections:

1. **Label**: 12px, uppercase, letter-spacing, accent color — Section category
2. **Heading**: Responsive clamp(), bold/black weight — Key message
3. **Description**: 16px, muted color, line-height 1.8 — Detailed explanation

**Emphasis patterns**:

- gradient text (`-webkit-background-clip: text`) — Title slide heading
- `<span class="em">` — Keyword emphasis within headings
- tag/chip — Inline tags

**Color limit**: At most 3 accent colors. See design-system.md for recommended palettes by theme.

**Fonts**:

- Default body font: **NanumSquareNeo** (`NanumSquareNeo`) — For @font-face blocks, see HTML Structure Rules item 7
- For English-only presentations: Plus Jakarta Sans, Outfit, or Geist (Google Fonts CDN)

---

## JavaScript Policy

- **Do not add external libraries**. Only the highlight.js CDN is allowed.
- **Include the Fullscreen toggle by default**: Include the `.fs-btn` button and `requestFullscreen` toggle script in all generated outputs (dark/light) by default. Omit only when the user explicitly requests exclusion. See "6. Fullscreen Toggle" in design-system.md for the detailed implementation.
- **Other vanilla JS presentation aids are allowed**: Add up to 30 lines of vanilla JS for keyboard arrow (←→) navigation, current-page indicators, etc. only when the user requests it.
- Default generation includes only `hljs.highlightAll()` and the Fullscreen toggle script.

---

## Anti-Patterns

- **No slide libraries**: Do not use reveal.js, impress.js, Marp, etc.
- **No generic fonts**: Do not use Arial, Inter, Roboto, or system-ui as the main font
- **No CSS frameworks**: Do not use Bootstrap, Tailwind, etc.
- **No excessive animation**: Do not use scroll-linked animations, fade-ins, slide-ins, etc. (scroll-hint bounce and hover transitions are exceptions)
- **No purple-and-white cliché**: Do not automatically use purple gradients. Choose accents suited to the content
- **No base64 images**: Do not embed encoded images
- **No fabricated data**: Do not guess figures, yearly trends, presentation titles, project names, job descriptions, etc. that the user did not provide. Leave information absent from the source data as placeholders (`[TODO: 데이터 필요]`) and ask the user to confirm

**Image/visual alternatives**:

- Use emoji by default when icons are needed. Use the Iconify CDN if more refined icons are needed (see allowed libraries below)
- Draw simple diagrams directly with CSS+HTML. Use Mermaid for complex flow/sequence/ER diagrams
- Where actual images (photos, screenshots) are needed, insert placeholders specifying aspect ratio and intent, and describe the recommended image in a comment
- Multimedia such as video/audio is not supported; propose a screenshot placeholder + link as an alternative

---

## Allowed CDN Libraries

**Allowlist approach**: Only libraries listed below may be used. Do not arbitrarily add libraries outside this list.
All libraries follow the **"include only when needed"** principle. If the corresponding content is absent, do not include the CDN.

**CDN URL rules**: Use the specified URLs and versions **exactly as written**. Do not arbitrarily upgrade versions or switch CDN hosts. (Because cdnjs often lacks the latest versions, use only jsdelivr or verified cdnjs URLs.)

**You must open `references/cdn-libraries.md` to check each library's CDN URL and markup pattern** (do not write URLs from memory or change them arbitrarily).

### Summary Table

| Library   | Inclusion condition                     | Related slide type           |
| ------------ | ----------------------------- | ---------------------------- |
| highlight.js | When code blocks are present           | `code`                       |
| Chart.js     | When visualizing numbers as charts     | Supplements `stat-grid`             |
| Mermaid      | When complex diagrams are needed | Advanced alternative to `flow`, `timeline` |
| KaTeX        | When mathematical formulas appear         | `content` (academic)             |
| Iconify      | When refined icons are needed     | `card-grid`, `flow`          |

---

## Reference Files

Files referenced by this skill. The workflow contains inline pointers; use this index if you missed when to open a file.

| File | Role | When to open |
| ---- | ---- | ---------------- |
| `references/design-system.md` | Built-in design system — component CSS, palettes, Fullscreen toggle implementation, flow 5-step variant, etc. | When selecting the "자체 심플" design path; when detailed implementations such as Fullscreen or flow variants are needed |
| `references/code-snippets.md` | `@font-face` font declarations, page-number CSS counter, typography baseline scale values | **Required before writing the HTML skeleton in Step 4** — Do not write fonts, page numbers, or scale values from memory |
| `references/cdn-libraries.md` | CDN URLs and markup patterns for allowed libraries (highlight.js / Chart.js / Mermaid / KaTeX / Iconify) | **Required when actually using the library** — Do not write URLs from memory or change them arbitrarily |
| `assets/example-dark.html` | Dark theme 4-slide example (technical presentation) — example of the target quality level in practice | When calibrating style and component placement before the first output (do not copy the template verbatim; freely adapt to the outline without being constrained by the example's slide structure/count) |
| `assets/example-light.html` | Light theme 4-slide example (business strategy) — example of the target quality level in practice | When calibrating style and component placement before the first output (do not copy the template verbatim; freely adapt to the outline without being constrained by the example's slide structure/count) |
| `slides-review` skill | Gemini design review — apply visual improvement feedback to generated HTML | Step 7 (optional design review); quiet pass if the gemini CLI is not installed |
