# CDN Libraries

## highlight.js — Code Syntax Highlighting

**Inclusion condition**: When code blocks are present

```html
<!-- Theme CSS in head -->
<!-- Dark: -->
<link
  rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"
/>
<!-- Light: -->
<link
  rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css"
/>

<!-- End of body -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
  hljs.highlightAll();
</script>
```

Markup: `<pre><code class="language-{lang}">...</code></pre>`. The `language-` prefix is required.

## Chart.js — Charts/Data Visualization

**Inclusion condition**: When displaying numerical data in bar, line, pie, radar, doughnut, or other charts. Use instead of or to supplement `stat-grid`.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
```

Markup: `<canvas id="myChart"></canvas>` + initialization script.
**Caution**: Set `animation: false` to prevent flickering during scrolling. For the dark theme, adjust `color`/`borderColor` to match the theme.

## Mermaid — Diagrams

**Inclusion condition**: When architecture diagrams, flowcharts, sequence diagrams, Gantt charts, or ER diagrams are needed. Use when drawing them with CSS+HTML would be complex.

```html
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ theme: 'dark', startOnLoad: true });
</script>
```

Markup: `<pre class="mermaid">graph LR; A-->B;</pre>`. For the light theme, change to `theme: 'default'`.

## KaTeX — Mathematical Formulas

**Inclusion condition**: When LaTeX mathematical formulas appear (academic presentations, algorithm explanations).

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
/>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
  renderMathInElement(document.body);
</script>
```

Markup: Inline `\( E = mc^2 \)`, block `$$ \sum_{i=1}^{n} x_i $$`.

## Iconify — Icons

**Inclusion condition**: When cards or items need icons more refined than emoji. Do not use if emoji suffice.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/iconify/2.0.0/iconify.min.js"></script>
```

Markup: `<span class="iconify" data-icon="lucide:rocket"></span>`. Access to 200,000+ icons including Lucide, Material, and Font Awesome.
