# CDN Libraries

## highlight.js — 코드 구문 강조

**포함 조건**: 코드 블럭이 있을 때

```html
<!-- head에 테마 CSS -->
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

<!-- body 끝 -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
  hljs.highlightAll();
</script>
```

마크업: `<pre><code class="language-{lang}">...</code></pre>`. `language-` 접두사 필수.

## Chart.js — 차트/데이터 시각화

**포함 조건**: 수치 데이터를 bar, line, pie, radar, doughnut 등 차트로 보여줄 때. `stat-grid` 대신 또는 보완으로 사용.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
```

마크업: `<canvas id="myChart"></canvas>` + 초기화 스크립트.
**주의**: `animation: false`로 설정하여 스크롤 시 깜빡임을 방지한다. 다크 테마에서는 `color`/`borderColor`를 테마에 맞게 조정.

## Mermaid — 다이어그램

**포함 조건**: 아키텍처, 플로우차트, 시퀀스 다이어그램, 간트 차트, ER 다이어그램이 필요할 때. CSS+HTML로 그리기 복잡한 경우 사용.

```html
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ theme: 'dark', startOnLoad: true });
</script>
```

마크업: `<pre class="mermaid">graph LR; A-->B;</pre>`. 라이트 테마에서는 `theme: 'default'`로 변경.

## KaTeX — 수학 수식

**포함 조건**: LaTeX 수학 수식이 등장할 때 (학술 발표, 알고리즘 설명).

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

마크업: 인라인 `\( E = mc^2 \)`, 블럭 `$$ \sum_{i=1}^{n} x_i $$`.

## Iconify — 아이콘

**포함 조건**: 카드나 항목에 emoji보다 정교한 아이콘이 필요할 때. emoji로 충분하면 사용하지 않는다.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/iconify/2.0.0/iconify.min.js"></script>
```

마크업: `<span class="iconify" data-icon="lucide:rocket"></span>`. Lucide, Material, Font Awesome 등 20만+ 아이콘 접근 가능.
