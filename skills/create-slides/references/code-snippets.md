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
  content: counter(slide, decimal-leading-zero) ' / {총 슬라이드 수}';
  position: absolute; /* fixed 절대 금지 */
  bottom: 24px;
  right: 32px;
  font-size: 13px;
  color: var(--text-muted);
}
```

## Typography 베이스라인 스케일

| 요소 | 베이스라인 | 비고 |
|------|-----------|------|
| h1 | `clamp(2.25rem, 8vw, 4rem)` | 타이틀 슬라이드 |
| h2 | `clamp(1.75rem, 5vw, 2.625rem)` | 섹션 헤딩 |
| h3 | `1.25rem` | 서브 헤딩 |
| .label | `13px`, letter-spacing 0.15em | 섹션 카테고리 |
| .desc | `16px`, line-height 1.8 | 본문 설명 |
| subtitle | `22px` | 타이틀 부제 |
| .card-title | `16px` | 카드 제목 |
| .card-desc | `13px` | 카드 설명 |
| .stat-num | `clamp(1.75rem, 6vw, 2.5rem)` | 통계 숫자 |
| .stat-label | `13px` | 통계 라벨 |
| pre code | `14px` | 코드 블럭 |
| .tag | `13px` | 태그/칩 |
| page number | `13px` | 슬라이드 번호 |
| slide padding (desktop) | `60px 80px` | 기본 여백 |
| slide padding (mobile) | `40px 24px` | 모바일 여백 |
| .slide__inner max-width | `720px` | 텍스트 콘텐츠 폭 |
| 다열 레이아웃 max-width | `960px` | 카드/비교/플로우 |
| card padding | `24px` | 카드 내부 여백 |
| card border-radius | `16px` | 카드 라운딩 |
| gap (기본) | `12px` | 그리드/플렉스 간격 |
