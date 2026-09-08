# Code Snippets

## Font-Face Declarations

```css
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
```

## Page Counter CSS

```css
body {
  counter-reset: slide;
}
.slide {
  counter-increment: slide;
  position: relative;
}
.slide::after {
  content: counter(slide, decimal-leading-zero) ' / {total slide count}';
  position: absolute; /* fixed is strictly prohibited */
  bottom: 24px;
  right: 32px;
  font-size: 13px;
  color: var(--text-muted);
}
```

## Typography Baseline Scale

| Element | Baseline | Notes |
|------|-----------|------|
| h1 | `clamp(2.25rem, 8vw, 4rem)` | Title slide |
| h2 | `clamp(1.75rem, 5vw, 2.625rem)` | Section heading |
| h3 | `1.25rem` | Subheading |
| .label | `13px`, letter-spacing 0.15em | Section category |
| .desc | `16px`, line-height 1.8 | Body description |
| subtitle | `22px` | Title subtitle |
| .card-title | `16px` | Card title |
| .card-desc | `13px` | Card description |
| .stat-num | `clamp(1.75rem, 6vw, 2.5rem)` | Statistical figure |
| .stat-label | `13px` | Statistics label |
| pre code | `14px` | Code block |
| .tag | `13px` | Tag/chip |
| page number | `13px` | Slide number |
| slide padding (desktop) | `60px 80px` | Default spacing |
| slide padding (mobile) | `40px 24px` | Mobile spacing |
| .slide__inner max-width | `720px` | Text content width |
| Multi-column layout max-width | `960px` | Cards/comparisons/flows |
| card padding | `24px` | Card inner spacing |
| card border-radius | `16px` | Card corner rounding |
| gap (default) | `12px` | Grid/flex spacing |
