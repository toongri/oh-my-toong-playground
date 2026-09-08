# Presentation Design System (Simple)

The design system used when **"2. 자체 디자인 가이드 (심플)"** is selected as the design style.
Based on a restrained minimal style, a consistent three-level typography hierarchy, and high-quality patterns extracted through reverse engineering.

> When `/frontend-design` is selected, follow the frontend-design skill's guidance instead of this document.

---

## 1. Dark Theme (Technical Presentations, Development Topics)

```css
:root {
  /* Background */
  --bg: #0a0a0a;
  --bg-gradient: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%);
  --surface: rgba(255, 255, 255, 0.04);
  --surface-hover: rgba(255, 255, 255, 0.06);
  --border: rgba(255, 255, 255, 0.08);
  --border-accent: rgba(255, 255, 255, 0.12);

  /* Text */
  --text-primary: #f5f5f5;
  --text-secondary: rgba(255, 255, 255, 0.7);
  --text-muted: rgba(255, 255, 255, 0.4);

  /* Accents — at most 3 colors, may be combined in gradients */
  --accent-1: #00d2ff;   /* cyan */
  --accent-2: #7b2ff7;   /* purple */
  --accent-3: #ff6b6b;   /* coral */

  /* Semantic */
  --accent-gradient: linear-gradient(135deg, var(--accent-1), var(--accent-2));
  --tag-bg: rgba(0, 210, 255, 0.15);
  --tag-color: #00d2ff;

  /* Font — NanumSquareNeo (default body font), insert @font-face blocks separately */
  --font-family: 'NanumSquareNeo', -apple-system, sans-serif;

  /* highlight.js */
  --hljs-theme: github-dark;
}
```

### Dark Background Variants (Subtle Variation per Slide)
```css
.slide--title  { background: var(--bg-gradient); }
.slide--problem { background: linear-gradient(180deg, #0a0a0a, #1a0a0a); }
.slide--solution { background: linear-gradient(180deg, #0a0a1a, #0a1a0a); }
.slide--closing { background: linear-gradient(135deg, #16213e, #1a1a2e, #0a0a0a); }
```

---

## 2. Light Theme (Planning Proposals, Business Topics)

```css
:root {
  /* Background */
  --bg: #FAFAF8;
  --bg-gradient: #FAFAF8;
  --surface: #FFFFFF;
  --surface-hover: #F5F4F0;
  --border: #EEEDEB;
  --border-accent: rgba(0, 0, 0, 0.1);

  /* Text */
  --text-primary: #1A1A1A;
  --text-secondary: #555555;
  --text-muted: #888888;

  /* Accents */
  --accent-1: #6C5CE7;   /* purple */
  --accent-2: #00B894;   /* green */
  --accent-3: #F0932B;   /* orange */

  /* Semantic */
  --accent-gradient: linear-gradient(135deg, var(--accent-1), var(--accent-2));
  --tag-bg: #F0EFFF;
  --tag-color: #6C5CE7;

  /* Font — NanumSquareNeo (default body font), insert @font-face blocks separately */
  --font-family: 'NanumSquareNeo', -apple-system, sans-serif;

  /* highlight.js */
  --hljs-theme: github;
}
```

---

## 3. Structural CSS (Shared)

```css
/* NanumSquareNeo @font-face (include only required weights) */
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-aLt.woff2);
  font-weight: 300;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-bRg.woff2);
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-cBd.woff2);
  font-weight: 700;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-dEb.woff2);
  font-weight: 800;
  font-display: swap;
}
@font-face {
  font-family: 'NanumSquareNeo';
  src: url(https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-eHv.woff2);
  font-weight: 900;
  font-display: swap;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

/* Page-by-page scroll snap */
html {
  scroll-snap-type: y mandatory;
  scroll-behavior: smooth;
}
body {
  font-family: var(--font-family);
  background: var(--bg);
  color: var(--text-primary);
  line-height: 1.7;
  overflow-x: hidden;
}

/* Slide defaults — fixed height + scroll-snap */
.slide {
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 60px 24px;
  position: relative;
  overflow: hidden;
  scroll-snap-align: start;
}

.slide__inner {
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

/* Dark theme slide separators */
.slide + .slide {
  border-top: 1px solid var(--border);
}
```

---

## 4. Typography Scale

```css
/* Section label — small category indicator */
.label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--accent-1);
  font-weight: 600;
  margin-bottom: 12px;
}

/* Main heading */
h1 {
  font-size: clamp(2.25rem, 8vw, 3.5rem);
  font-weight: 900;
  line-height: 1.15;
  margin-bottom: 20px;
}

h2 {
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 16px;
}

h3 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 12px;
}

/* Body description */
.desc {
  font-size: 1rem;
  color: var(--text-secondary);
  line-height: 1.8;
  margin-bottom: 32px;
}

/* Statistical figures */
.stat-num {
  font-size: clamp(1.75rem, 6vw, 2.5rem);
  font-weight: 800;
  color: var(--accent-1);
}

/* Emphasized text — gradient clip */
.gradient-text {
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Emphasis within headings */
h2 .em { color: var(--accent-1); }
h2 .em2 { color: var(--accent-2); }
h2 .em3 { color: var(--accent-3); }
```

---

## 5. Component Patterns

### Card
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
}
.card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.card-icon { font-size: 2rem; margin-bottom: 10px; }
.card-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.card-desc { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
```

### Stat Box
```css
.stat-row {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
}
.stat-box {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  text-align: center;
}
.stat-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}
```

### Timeline
```css
.timeline {
  position: relative;
  padding-left: 32px;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--border);
}
.tl-item { position: relative; margin-bottom: 28px; }
.tl-dot {
  position: absolute;
  left: -27px;
  top: 6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 3px solid var(--accent-1);
  background: var(--bg);
}
.tl-dot.active { background: var(--accent-1); }
.tl-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.tl-desc { font-size: 14px; color: var(--text-muted); }
```

### Flow Diagram
```css
.flow-container {
  display: flex;
  align-items: stretch;
  gap: 0;
}
.flow-step {
  flex: 1;
  text-align: center;
  padding: 28px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
}
.flow-step:first-child { border-radius: 16px 0 0 16px; }
.flow-step:last-child { border-radius: 0 16px 16px 0; }
.flow-num {
  display: inline-block;
  width: 32px; height: 32px;
  line-height: 32px;
  border-radius: 50%;
  background: var(--accent-gradient);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 12px;
}
.flow-arrow {
  display: flex;
  align-items: center;
  font-size: 20px;
  color: var(--text-muted);
  flex-shrink: 0;
  padding: 0 4px;
}
```

### Quote
```css
.quote-box {
  background: var(--surface);
  border-left: 4px solid var(--accent-1);
  border-radius: 0 14px 14px 0;
  padding: 24px;
  margin-bottom: 32px;
}
.quote-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.8;
}
.quote-author {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 8px;
}
```

### Code Block (highlight.js Integration)
```css
pre {
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 24px;
}
pre code {
  font-size: 14px;
  line-height: 1.6;
  padding: 24px !important;
}
```

### Tag / Chip
```css
.tag {
  display: inline-block;
  background: var(--tag-bg);
  color: var(--tag-color);
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 500;
  margin: 0 4px 8px 0;
}
```

### Comparison (Side-by-side)
```css
.comparison {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 16px;
  align-items: center;
}
.comparison-col {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
}
.comparison-divider {
  font-size: 24px;
  color: var(--text-muted);
}
```

### Naming / Formula Box
```css
.naming-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 32px;
  text-align: center;
  margin-bottom: 32px;
}
.naming-formula {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.naming-chip {
  background: var(--tag-bg);
  color: var(--tag-color);
  padding: 8px 16px;
  border-radius: 99px;
  font-size: 14px;
  font-weight: 600;
}
```

### Waterfall Diagram (CSS)
```css
/* Use for dependency timelines and span duration visualization */
.waterfall { margin-bottom: 24px; }
.wf-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  font-size: 13px;
}
.wf-label {
  width: 180px;
  flex-shrink: 0;
  color: var(--text-secondary);
  text-align: right;
  padding-right: 16px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
}
.wf-bar-container {
  flex: 1;
  height: 28px;
  position: relative;
}
.wf-bar {
  position: absolute;
  height: 100%;
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}
```

HTML pattern:
```html
<div class="waterfall">
  <div class="wf-row">
    <div class="wf-label">Service A</div>
    <div class="wf-bar-container">
      <div class="wf-bar" style="left:0; width:30%; background:rgba(0,210,255,0.25);">300ms</div>
    </div>
  </div>
  <div class="wf-row">
    <div class="wf-label" style="padding-left:16px; color:var(--accent-3);">Service B ← 병목</div>
    <div class="wf-bar-container">
      <div class="wf-bar" style="left:5%; width:60%; background:var(--accent-3); font-weight:700;">600ms ← 병목!</div>
    </div>
  </div>
</div>
```

`left` and `width` express timeline position and proportional duration as percentages.
Emphasis bar: Highlight bottleneck intervals with `background: var(--accent-3)`.

---

### Inline SVG Diagram
```css
.diagram-wrap {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}
.diagram-wrap svg {
  width: 100%;
  height: auto;
  overflow: visible;
}
.diagram-wrap svg text {
  font-family: var(--font-family);
  fill: var(--text-primary);
}
.diagram-wrap .diag-node rect {
  fill: var(--surface);
  stroke: var(--border-accent);
}
.diagram-wrap .diag-node text {
  font-size: 13px;
  font-weight: 600;
  fill: var(--text-primary);
}
.diagram-wrap .diag-node--accent rect {
  fill: none;
  stroke: var(--accent-1);
  stroke-width: 2;
}
.diagram-wrap .diag-node--accent text {
  fill: var(--accent-1);
}
.diagram-wrap .diag-edge {
  fill: none;
  stroke: var(--border-accent);
  stroke-width: 1.5;
}
.diagram-wrap .diag-edge--accent {
  stroke: var(--accent-1);
  stroke-width: 2;
}
.diagram-wrap .diag-label {
  font-size: 11px;
  fill: var(--text-muted);
}
```

SVG `<defs>` marker pattern:
<!-- Put the slide number in N to prevent global id collisions -->
```html
<defs>
  <marker id="diag-arrow-s{N}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L0,6 L8,3 z" style="fill: var(--border-accent)" />
  </marker>
  <marker id="diag-arrow-accent-s{N}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L0,6 L8,3 z" style="fill: var(--accent-1)" />
  </marker>
</defs>
```

> **Caution**: An `id` must be globally unique within an HTML document. When a presentation has multiple `diagram` slides or they coexist with Mermaid, duplicate `id="arrow"` values cause `url(#arrow)` references to malfunction. You must include the slide number (e.g., `diag-arrow-s5`).

7 nodes or fewer → `diagram` type. More nodes, or sequence/ER diagrams → Use Mermaid CDN.

---

### Workflow Grid
```css
.workflow-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0;
}
.wf-step {
  position: relative;
  text-align: center;
  padding: 28px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-right: none;
}
.wf-step:first-child { border-radius: 16px 0 0 16px; }
.wf-step:last-child {
  border-radius: 0 16px 16px 0;
  border-right: 1px solid var(--border);
}
.wf-step::after {
  content: '';
  position: absolute;
  right: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
  border-left: 10px solid var(--border-accent);
  z-index: 1;
}
.wf-step:last-child::after { display: none; }
.wf-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  margin: 0 auto 10px;
}
.wf-icon { font-size: 1.5rem; margin-bottom: 8px; display: block; }
.wf-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; color: var(--text-primary); }
.wf-desc { font-size: 11px; color: var(--text-muted); line-height: 1.5; }
```

---

### Hero Badge Row
```css
.hero-badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 32px;
  align-self: center;
  width: fit-content;
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: var(--surface);
  border: 1px solid var(--border-accent);
  border-radius: 99px;
  padding: 6px 14px 6px 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}
.hero-badge::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-1);
  flex-shrink: 0;
}
.hero-badge--2::before { background: var(--accent-2); }
.hero-badge--3::before { background: var(--accent-3); }
.hero-badge--highlight {
  background: var(--tag-bg);
  color: var(--tag-color);
  border-color: transparent;
}
.hero-badge--highlight::before { background: var(--tag-color); }
```


## 6. Fullscreen Toggle (Enabled by Default)

A fullscreen toggle button that hides browser UI during presentations. Include by default in both dark/light themes. Feature detection automatically hides the button in environments without `requestFullscreen` support, such as iOS Safari.

```css
.fs-btn {
  position: fixed;
  bottom: 24px; left: 24px;
  z-index: 100;
  width: 40px; height: 40px;
  border-radius: 99px;
  background: var(--surface);
  border: 1px solid var(--border-accent);
  color: var(--text-secondary);
  font-size: 18px; line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: border-color 0.2s ease, color 0.2s ease;
  display: flex; align-items: center; justify-content: center;
}
.fs-btn:hover { border-color: rgba(255,255,255,0.3); color: #fff; }
@media print { .fs-btn { display: none; } }
```

The light theme uses hardcoded colors instead of CSS variables (`background: rgba(255,255,255,0.75)`, `border: #E5E4E2`, `color: #666`, accent color on hover).

HTML:

```html
<button class="fs-btn" id="fsBtn" type="button" aria-label="전체화면 전환" title="전체화면 (F)">⛶</button>
```

JS (place at the end of body, after the hljs script):

```js
(function () {
  var btn = document.getElementById('fsBtn');
  if (!btn) return;
  var root = document.documentElement;
  if (!root.requestFullscreen) { btn.style.display = 'none'; return; }
  function sync() { btn.textContent = document.fullscreenElement ? '\u2715' : '\u26F6'; }
  btn.addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else { root.requestFullscreen(); }
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'f' && e.key !== 'F') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    btn.click();
  });
})();
```

- Icons: `⛶` (U+26F6) → Enter, `✕` (U+2715) → Exit
- F keyboard shortcut: Global toggle, disabled when input/textarea/contentEditable has focus
- Place at the bottom left to avoid conflicting with `.slide::after` page numbers (bottom right)

---

## 7. Page Number (Optional, Enabled by Default for Dark Theme)

```css
body { counter-reset: slide; }
.slide::after {
  counter-increment: slide;
  content: counter(slide, decimal-leading-zero);
  position: absolute;
  bottom: 30px;
  right: 40px;
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
}
```

---

## 8. Responsive (768px and Below)

```css
@media (max-width: 768px) {
  .slide { padding: 40px 24px; }
  .card-grid { grid-template-columns: 1fr; }
  .stat-row { flex-direction: column; }
  .flow-container { flex-direction: column; }
  .flow-step:first-child { border-radius: 16px 16px 0 0; }
  .flow-step:last-child { border-radius: 0 0 16px 16px; }
  .flow-arrow { transform: rotate(90deg); justify-content: center; }
  .comparison { grid-template-columns: 1fr; }
  .comparison-divider { transform: rotate(90deg); }
  .workflow-grid { grid-template-columns: 1fr; }
  .wf-step {
    border-right: 1px solid var(--border);
    border-bottom: none;
    border-radius: 0;
  }
  .wf-step:first-child { border-radius: 16px 16px 0 0; }
  .wf-step:last-child {
    border-radius: 0 0 16px 16px;
    border-bottom: 1px solid var(--border);
  }
  .wf-step::after {
    right: auto;
    left: 50%;
    top: auto;
    bottom: -10px;
    transform: translateX(-50%);
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 10px solid var(--border-accent);
    border-bottom: none;
  }
}
```

---

## 9. highlight.js CDN

```html
<!-- Dark theme -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">

<!-- Light theme -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">

<!-- Shared script (end of body) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>hljs.highlightAll();</script>
```

Code block markup:
```html
<pre><code class="language-javascript">
const hello = "world";
</code></pre>
```

Supported languages: `javascript`, `typescript`, `python`, `rust`, `go`, `java`, `kotlin`, `css`, `html`, `bash`, `json`, `yaml`, `sql`, etc. The `language-` prefix is required.
