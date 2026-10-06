# fc-feedback 뷰어 디자인 계약 v2

이 문서는 `render.ts`가 만드는 정적 HTML(세션 뷰어, 아카이브 첫 페이지, 참고자료 페이지)의
설계 의도 계약서다. 참조 목업이 없으므로 `visual-qa` 스킬이 이 문서를 판정 기준으로 렌더 결과를
반복 검수한다(승인까지 무한 루프). 모든 색상·간격·반경·타입 크기는 아래 토큰에서 나오며,
토큰에 없는 값을 코드에 쓰면 먼저 이 문서에 토큰을 추가한다.

**v2는 패치가 아니라 재설계다.** 계기는 두 가지다. 첫째, 사용자가 v1의 문제/누구/대신
3칸 구조(dl)가 복잡한 축구 장면을 담지 못하고 결과 0건 필터 버튼이 많다고 "너무 구리다"고
판정했다. 둘째, 1차 시각 QA가 v1의 grid 레이아웃(`.side`의 `grid-row: 1 / -1` 행-걸침 +
`overflow: auto` 컬럼 안 `flex-shrink: 0` 누락)에서 구조적 결함 두 가지를 확정했다 —
(A) sticky 플레이어가 목차 길이에 따라 높이 0으로 무너짐, (B) 헤더-본문 사이 뷰포트
높이만큼의 빈 공백. v2는 이 grid 구조 자체를 버리고 §4의 flex 레이아웃으로 교체해, 같은
결함 클래스가 재발할 수 없게 한다.

## 0. 리서치 로그

v1의 임베디드 참조(notion/linear.app 구조 문법)와 라이트 테마·단일 액센트·시스템 폰트 결정은
그대로 유지한다. v2 재설계 근거: 전술 분석 아티클(Coaches' Voice, 이미지=직전 문단의 시각
증거로 본문 컬럼 전체 폭 삽입, 볼드는 선수 이름 첫 등장에만, §5 근거) · 영상 리뷰 도구
(Hudl/Loom/Veo, 클립 1개=노트 1개, 타임스탬프 클릭 시크, §5) · 필터 UX(Baymard, 개수 표시,
0건 숨김, 활성 필터 칩+전체 해제, §6·§7) · 한글 타이포(KRDS, 본문 17px/행간 1.6–1.8/
`keep-all`, §1) · 카드 밀도(태그 6개+"+N", 칩 대비 4.5:1 이상). 커밋한 방향: 노트는
**문단과 사진이 섞인 짧은 기사**, 팀원은 **자기 이름을 눌러 자기 피드백만** 보는 것이 가장
눈에 띄는 동작이 된다.

## 1. 원칙 (우선순위 순서)

아래 순서는 화면을 만들 때 충돌이 생기면 위 항목이 아래 항목을 이긴다는 뜻이다.

1. **팀원별 명확성이 최우선이다.** "내 피드백" 동선(§6) — 자기 이름을 선택해 자기 피드백만
   골라보는 것 — 은 일반 필터(§7)와 시각적으로 분리된, 화면에서 가장 눈에 띄는 컨트롤이다.
   이름 옆 개수로 누르기 전에도 건수를 알 수 있고, 1회 탭으로 그 즉시 자기 개선점만 보인다.
2. **본문 가독성이 두 번째다.** 노트는 요약이 아니라 잘 정리된 문단이다 — 영상을 보지 않아도
   문단과 사진만으로 장면의 윤곽을 알 수 있어야 한다. 강조는 `**볼드**`만 쓴다(§5).
3. **이미지는 증거다.** 대표 시작 이미지와 본문 중 프레임은 장식이 아니라 "이 장면이 실제로
   이랬다"는 증거이므로, 읽기 컬럼 전체 폭으로 크게 보이고 캡션(시간 칩 포함)을 반드시 단다.
4. **내비게이션은 그다음이다.** 목차(§8)·필터(§7)·영상 전환(§9)은 위 세 원칙을 방해하지 않는
   범위에서 빠르게 원하는 장면을 찾도록 돕는다. 결과가 0건인 선택지는 애초에 누를 수 없게
   보여주지 않는다 — 있는지 없는지 눌러보고 확인하게 만들지 않는다.

## 2. 토큰

라이트 테마만 지원한다(`prefers-color-scheme: dark` 미디어 쿼리를 만들지 않는다). 액센트는
"피치 그린" 하나뿐이며 인터랙티브 요소(링크, 포커스, 활성 탭/버튼/칩/pill)에만 쓰고 장식에는
쓰지 않는다. v1에서 이미 대비 검증을 통과한 값은 그대로 이어받는다.

### 색상

| 역할 | 토큰 | 값 | 용도 |
|---|---|---|---|
| 배경 | `--bg` | `#FFFFFF` | 페이지 배경, **카드 배경**(카드는 패널이 아니라 본문과 같은 표면이다), 액센트·잉크(어두운) 배경 위의 흰 텍스트(플레이어 placeholder·mini-bar 텍스트, 눌림 상태 pill/chip/배지 글자) — raw `#fff`를 이 토큰으로 대체한다(§15-2) |
| 표면 | `--surface` | `#F6F8F7` | 필터 바·패널·시트(`<details>` 필터[모든 폭], §7)·빈 상태 패널(§10) 배경 전용. **카드 배경에는 쓰지 않는다** |
| 표면(눌림) | `--surface-sunken` | `#EFF2F0` | details 열림, 주제 칩 배경, "+N" 칩 배경 |
| 본문 텍스트 | `--ink` | `#14181C` | 제목, 본문(업계 기준 #333 계열보다 진하며 대비는 더 높다) |
| 보조 텍스트 | `--muted` | `#57606A` | 메타, 캡션, 타임스탬프 (흰 배경 대비 ≥4.5:1) |
| 보더 | `--line` | `#E3E6E8` | 카드/이미지/figure 등 **비인터랙티브** 요소의 장식·구획용 구분선 전용. 흰 배경 대비 1.25:1로 3:1 요구에 못 미치므로 인터랙티브 요소 경계에는 쓰지 않는다 |
| 보더(강조) | `--line-strong` | `#838B93` | 칩·pill·버튼·part 전환 버튼·details summary 등 **인터랙티브 컨트롤**의 경계 전용. 흰 배경 대비 3.45:1(≥3:1 충족) |
| 액센트 | `--accent` | `#1E7A46` | 링크, 활성 탭/버튼/칩/pill, 포커스 (흰 배경 대비 5.3:1) |
| 액센트 hover | `--accent-hover` | `#145C34` | 액센트 요소 hover/active |
| 액센트 틴트 | `--mine-tint` | `#E3F3E9` | "내 피드백" 선택 시 본문 이름 강조(§5)만. 액센트를 옅게 희석한 값이며 독립된 두 번째 색이 아니다 |
| 포커스 링 | `--focus` | `#1E7A46` | `outline` 색 (§13 접근성) |
| 플레이어 컨트롤 배경 | `--player-control-bg` | `rgba(255,255,255,0.9)` | 1024px 미만에서 영상 아래 `.player-toolbar`(§4, 영상 위 오버레이가 아니다) 위에 놓이는 "플레이어 접기" 버튼의 반투명 배경 전용(어두운 툴바 배경 위에서도 텍스트 대비를 확보하려고 반투명 흰색을 쓴다) |
| 포지션 GK | `--pos-gk-bg` / `--pos-gk-fg` | `#FDF1D8` / `#8A5A00` | GK 칩 배경/글자 |
| 포지션 DF | `--pos-df-bg` / `--pos-df-fg` | `#E4EEFC` / `#1451B0` | DF 칩 배경/글자 |
| 포지션 MF | `--pos-mf-bg` / `--pos-mf-fg` | `#E7F0EE` / `#0F6B5C` | MF 칩 배경/글자 |
| 포지션 FW | `--pos-fw-bg` / `--pos-fw-fg` | `#FBE7E4` / `#B23A2E` | FW 칩 배경/글자 |

규칙: 포지션 4색은 GK/DF/MF/FW 칩 전용이며 다른 용도(상태 표시 등)에 재사용하지 않는다.
`--mine-tint`는 §5의 이름 강조 한 곳에만 쓴다 — 두 번째 액센트가 아니라 첫 번째 액센트의
옅은 변형이다. 이 표에 없는 raw hex는 코드에 쓰지 않는다.

### 간격 (base 4px) · 반경

| 토큰 | 값 | 용도 |
|---|---|---|
| `--space-1` | 4px | 칩 내부 아이콘-라벨 간격 |
| `--space-2` | 8px | 칩 사이 간격, 인라인 그룹 |
| `--space-3` | 12px | 폼/버튼 내부 패딩, **카드 제목→본문 첫 문단 간격**(§5) |
| `--space-4` | 16px | 카드 내부 패딩, 섹션 사이 기본 간격, **본문 문단 사이 간격**(§5) |
| `--space-6` | 24px | 카드 사이 간격, 레이아웃 컬럼 gap, **본문 문단→프레임 간격**(§5) |
| `--space-8` | 32px | 섹션(헤더/내 피드백/필터/카드 목록/푸터) 사이 큰 간격 |
| `--radius-sm` | 8px | 카드, 입력, 이미지, figure |
| `--radius-md` | 12px | 패널, details |
| `--radius-full` | 9999px | 칩, pill, 필터 리셋 버튼 |

간격은 위 토큰만 쓴다(`clamp()`/`auto`/`%`/`minmax()` 같은 브라우저 메커닉스는 그대로 raw로
쓴다). 반경은 이 3단계만 쓴다 — 카드/이미지/figure는 항상 `--radius-sm`, 칩·pill은 항상
`--radius-full`. `.chip`의 칩-칩 간 외부 margin도 `--space-1`을 재사용한다(flex `gap` 없이 인라인 흐름으로 줄바꿈되는 주제/이름이 나온 선수 칩 목록의 최소 간격).

보더 두께는 간격 토큰과 별도다 — 장식용 구분선은 1px, `:focus-visible`과 `.card--highlighted`(§8 TOC 하이라이트)만 2px 고정값(4px 배수 스케일을 끌어오면 두꺼워진다)이라 토큰화하지 않는다.

### 타입 스케일

| 레벨 | 크기 | 굵기 | 행간 | 용도 |
|---|---|---|---|---|
| H1 | 28px / 1.75rem | 700 | 1.3 | 세션 제목, 아카이브 제목 |
| H2 | 22px / 1.375rem | 700 | 1.35 | 경기 제목, 주제 그룹 헤더(목차) |
| H3 | 20px / 1.25rem | 700 | 1.4 | 카드 제목 |
| Body | 17px / 1.0625rem | 400 | 1.7 | 노트 본문 문단, 참고자료 한국어 요약 |
| Label | 13px / 0.8125rem | 600 | 1.4 | 칩, pill, 브레드크럼, 시간 칩, 탭 라벨 |
| Caption | 14px / 0.875rem | 500 | 1.5 | 이미지 캡션, 카운트, 언어 배지 |

규칙: 읽기 단락(Body)은 16px 미만으로 내려가지 않는다. 칩·pill·배지·타임스탬프 같은 비단락
UI 라벨만 13–14px까지 허용한다. 행간은 Body 1.7을 최소로 유지하며 1.6 미만으로 내려가지
않는다(§13 판정 기준의 차단 항목). 자간은 모든 레벨에서 `normal`을 쓴다.

### 측정폭(measure)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--measure` | 660px | 읽기 컬럼(`.main`) 전체 폭 상한. 문단과 figure 모두 이 폭 안에서 렌더되므로 "본문 가독성"과 "이미지는 읽기 컬럼 전체 폭"이 서로 충돌하지 않는다 |
| `--archive-measure` | 960px | 아카이브 첫 페이지·참고자료 페이지(`.archive-main`, `.ref-main`)의 폭 상한. 세션 뷰어의 2컬럼 레이아웃이 없는 목록형 페이지라 `--measure`보다 넓게 잡는다 |
| `--content-max` | `calc(420px + var(--space-6) + var(--measure))` | `.header`/`.footer`/`.layout`의 공통 폭 상한(§4). `.side-col` 최대 폭(420px)+컬럼 gap+`--measure`를 그대로 더해, 헤더·본문·푸터가 항상 같은 좌우 폭·왼쪽 끝을 공유하게 한다 |

`--measure`는 660–680px 권장 범위의 하한을 택한 값이며 720px을 넘기면 차단 결함이다(§13).

## 3. 브레이크포인트

| 이름 | 폭 | 의미 |
|---|---|---|
| mobile | 390px | 최소 지원 폭, `<1024px` 레이아웃의 대표 캡처 폭 |
| layout-switch | 1024px | 좌우 2컬럼 ↔ 단일 컬럼 전환 지점(`@media (min-width: 1024px)`) |
| desktop | 1440px | 데스크톱 대표 캡처 폭 |

1024px 경계값 자체도 모든 회차의 기본 캡처 세트에 포함한다(§14).

## 4. 레이아웃

v1의 결함(§0)은 grid의 `grid-row: 1 / -1` 행-걸침과 `overflow: auto` flex 컬럼 안 아이템의
암묵적 최소 크기 0 축소가 만든 것이었다. v2는 **grid의 행-걸침을 아예 쓰지 않는 flex 2컬럼
구조**로 바꿔 이 결함 클래스 자체를 구조적으로 배제한다.

### 마크업 골격(모든 폭 공통)

```
<header class="header">...세션 제목, "영상 업로드 YYYY-MM-DD"...</header>
<div class="layout">
  <div class="side-col">
    <div class="player-wrapper">
      ...플레이어(.player-media)...
      <div class="player-toolbar">
        <span class="player-mini-bar-text">...접힘 상태 표시...</span>
        <button type="button" class="player-collapse" aria-expanded="true"
                aria-controls="player-media">플레이어 접기</button>
      </div>
    </div>
    <aside class="side">
      <div class="part-switch">...</div>
      <div class="toc-scroll"><div class="toc-collapsible">
        <button type="button" class="toc-toggle" aria-expanded="false" aria-controls="toc-panel">목차</button>
        <div class="toc-panel" id="toc-panel" hidden>...목차(§8)...</div>
      </div></div>
    </aside>
  </div>
  <div class="main">
    ...내 피드백(§6), 필터 바(§7), 활성 필터 요약, 결과 수, 카드 목록(§5), 빈 상태(§10)...
  </div>
</div>
<footer class="footer">...</footer>
```

**링크 전용 세션**(`data.videos` 전부 `embeddable: false`, §9): `.player-wrapper` 대신 작은 비-sticky
`.watch-bar`(파트마다 "유튜브에서 시청 ↗" 링크 하나, 다중 파트면 "Part N " 접두, 링크 min-height 44px)를
같은 자리에 렌더하고 `.part-switch`는 렌더하지 않는다(전환할 플레이어가 없고, 막대가 파트별 링크를 이미 제공). 막대 안 링크 옆에 안내 한 줄 `<span class="watch-bar-note">시간을 누르면 유튜브에서 그 장면부터 열립니다</span>`(Label 크기 0.8125rem — §2 타입 스케일의 가장 작은 단계, 스케일 밖 0.75rem 금지·`--muted`, 파트 수와 무관하게 한 번, 새 줄 전체 폭)을 둔다 — 카드의 시간 칩이 진짜 링크라는 사실을 알린다. 임베드가 되는 세션에는 렌더하지 않는다.
`<body data-link-only="true">`가 붙는다. 1024px 미만에서는 `order: 1`(플레이어와 같은 자리)이며 sticky가 아니다 —
임베드가 안 되는 플레이스홀더가 폰 화면 29%를 차지하며 숨은 링크만 바꾸던 결함을 없앤다.

`.side-col`은 `.player-wrapper`와 `.side`(part-switch+목차)를 묶는 그룹핑 wrapper일 뿐이다 —
1024px 이상에서만 실제 박스가 되고, 미만에서는 `display: contents`로 지워진다(아래 참고).

목차는 `<details>`가 아니라 `.toc-toggle`(`aria-expanded` 버튼) + `.toc-panel`(`hidden`
속성) 조합으로 감싼다 — 닫힌 `<details>`는 크로미움이 내부적으로 `content-visibility: hidden`을
걸어, 자식에 `display: block`을 강제해도 클릭이 안 되는 유령 레이아웃만 남기기 때문이다
(`[hidden]`은 평범한 `display: none`이라 안전하게 덮어쓸 수 있다). 1024px 미만은 `hidden`
기본 포함으로 닫힘(§1 원칙 1), 1024px 이상은 `.toc-toggle`을 숨기고 `.toc-panel[hidden]`을
`display: block`으로 강제해 항상 펼쳐 보여준다. `.toc-toggle`의 닫힌 모양은 §7 필터 바
`summary`와 같은 전체 폭 한 줄(라벨 왼쪽, `▾`/`▴` 오른쪽, `min-height: 44px`)이다.

`header`와 `footer`는 `.layout` 바깥의 독립된 형제 요소다 — v1처럼 소스 순서를 강제하려고
`order`/`display: contents`를 쓸 필요가 없다. 헤더가 항상 최상단에, 푸터가 항상 최하단에
오는 것은 이 마크업 순서 자체가 보장한다.

### 1024px 이상 (좌: 플레이어+목차, 우: 읽기 컬럼)

```
.header, .footer, .layout { max-width: var(--content-max); margin: 0 auto; }
.layout   { display: flex; align-items: flex-start; gap: var(--space-6); }
.side-col { flex: 0 0 min(420px, 40%); position: sticky; top: var(--space-6);
            max-height: calc(100dvh - var(--space-6) * 2);
            display: flex; flex-direction: column; gap: var(--space-4); }
.player-wrapper { flex-shrink: 0; width: 100%; aspect-ratio: 16 / 9; }
.side     { flex: 1 1 auto; min-height: 0;
            display: flex; flex-direction: column; gap: var(--space-4); }
.part-switch    { flex-shrink: 0; }
.toc-scroll     { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.main   { flex: 1 1 auto; min-width: 0; max-width: var(--measure);
          display: flex; flex-direction: column; gap: var(--space-8); }
```

이 구조가 v1 결함을 재발 불가능하게 만드는 이유:

- `.layout`은 grid가 아니라 flex다. `.side-col`은 flex 아이템 하나일 뿐 어떤 행도 걸치지 않으므로, v1처럼 암묵 행 트랙이 헤더 행을 부풀려 우측 컬럼이 한 화면 높이만큼 밀리는 일이 일어날 수 없다(v1 결함 B).
- `.side-col` 안에서 `overflow-y: auto`는 `.toc-scroll` 하나뿐이고 `.player-wrapper`/`.part-switch`는 `flex-shrink: 0`으로 고정해, 공간이 모자랄 때 줄어드는 것은 항상 목차이지 플레이어가 아니다(v1 결함 A).
- 우측의 헤더/필터/카드/빈 상태는 `.main`이라는 **단일 wrapper** 안에 있어, v1처럼 grid의 독립된 자식으로 흩어져 서로 다른 행에 잘못 배치될 수 없다.

플레이어를 좌측 독립 컬럼에 고정한 이유: 영상과 읽기 컬럼이 같은 스크롤 맥락을 공유하지 않게 해, "카드를 스크롤했더니 플레이어가 밀려 사라진다/찌그러진다"는 v1식 결함을 구조적으로 막는다(손 닿는 곳에 항상 플레이어가 있어야 한다는 §0 근거).

**단일 정렬 축**(§2 `--content-max`): `.header`/`.footer`/`.layout` 셋 다 같은
`--content-max` 상한+`margin: 0 auto`를 써서 항상 같은 왼쪽·오른쪽 끝을 공유한다. 이전엔
헤더/푸터가 별도 상한(1440px)을 써 `.layout`과 다른 왼쪽 끝이 생겼다 — `--content-max`가
`.side-col`+gap+`--measure`를 정확히 더한 값이라 1440px에서도 남는 공간이 생기지 않는다.

### 1024px 미만 (단일 컬럼, sticky 플레이어)

```
@media (max-width: 1023.98px) {
  .layout   { flex-direction: column; align-items: stretch; }
  .header, .footer { padding-left: var(--space-4); padding-right: var(--space-4); }
  .side-col, .side, .main { display: contents; }
  .player-wrapper { order: 1; position: sticky; top: 0; z-index: 10;
                     aspect-ratio: auto; height: auto;
                     display: flex; flex-direction: column; }
  .player-media { height: min(56.25vw, 200px); } /* 펼침: 영상 ≤200px + 툴바 44px = 전체 ≤244px */
  .player-wrapper.is-collapsed .player-media { height: 0; } /* 접힘: 툴바 44px만 남는다 */
  /* order 2~10: part-switch, my-feedback, filter-bar, active-filters,
     toc-scroll(필터 바 바로 다음, 접힘), active-filters, result-count, recurring(§6a), card-list, empty-state,
     matches-without-feedback(§5b) */
  .toc-scroll { overflow-y: visible; } /* .toc-panel이 hidden으로 접히므로 자체 스크롤 불필요 */
}
```

`align-items: stretch`(기본값 `flex-start` 대체): 필터 바·목차 토글의 닫힌 줄, 활성 필터
줄, 빈 상태 패널이 모두 `.layout`의 flex 아이템이므로, `stretch`가 없으면 내용 폭만큼만
좁게 그려져 필터/목차 토글이 작은 알약 모양이 된다(390px 결함). `--content-max`가 없는
1024px 미만에서는 `.header`/`.footer`의 좌우 패딩을 `--space-4`로 직접 줘 본문 폭과
맞춘다(위 §4 마크업 골격 참고).

**왜 세 wrapper를 모두 `display: contents`로 지우는가**: v1은 플레이어를 짧은 `.side`에 가둬 sticky containing block이 카드 구간에서 끊겼다. v2는 `.side-col`·`.side`·`.main`을 전부 지워 모든 섹션을 `.layout`(전체 스크롤 길이) 하나의 flex 아이템으로 만들어 containing block을 넓히는 동시에, 마크업 순서와 무관하게 위 `order`만으로 재배치할 수 있게 한다 — 2차 시각 QA가 지적한 "목차가 '내 피드백'보다 먼저 나와 약 1950px 아래로 밀린다" 결함이 이걸로 없어진다. 목차 토글(order 5)은 카드 목록 맨 뒤가 아니라 필터 바 바로 다음에 둔다 — 36장짜리 페이지에서 맨 뒤는 약 32,000px 아래라 모바일 독자가 목차를 쓸 수 없었다(리뷰 결함). 토글은 닫힌 한 줄(44px)이라 "내 피드백"(§1 원칙 1)을 밀어내지 않는다. 데스크톱의 좌측 목차는 그대로다.

펼친 상태의 sticky 플레이어 전체 높이(영상 `.player-media` ≤200px + 항상 보이는 `.player-toolbar` 44px, 아래 §4 "플레이어 접기" 참고)는 244px을 넘지 않아 세로로 긴 화면에서 뷰포트 절반을 차지하는 사고를 막는다 — iframe 위 오버레이를 금지하는 원칙(§4 "플레이어 접기")이 접기 버튼을 영상과 별도인 툴바 행으로 밀어냈으므로, 200px 계약은 영상 자체에만 적용되고 툴바 44px은 그 위에 더해진다. 필터 바(§7)는 모든 폭에서 기본 닫힘, 목차(§8)는 1024px 미만에서만 `.toc-panel[hidden]`으로 기본 닫힘이다. header/footer는 `.layout` 밖 실제 형제라 v1식 순서 강제가 필요 없다.

### 플레이어 접기(1024px 미만 전용)

**플레이어 iframe 위에는 어떤 컨트롤도 겹쳐 두지 않는다(유튜브 자체 UI와 충돌)** — 라운드7 시각 QA가 우측 하단 오버레이 버튼과 유튜브 워터마크/진행 바의 충돌을 지적한 뒤의 원칙이다. `.player-wrapper`는 `.player-media`(영상)와 `.player-toolbar`(버튼 줄) 두 flex 자식을 세로로 쌓는다 — 버튼은 영상 위 오버레이가 아니라 영상 바로 아래 전체 폭 줄(오른쪽 정렬)에 항상 있다. "플레이어 접기" 버튼(`aria-expanded`)을 누르면 플레이어가 44px로 접힌다:

- 접힌 상태: `.player-wrapper.is-collapsed`, 라벨은 "펼치기", `aria-expanded="false"`. `.player-media`가 높이 0으로 접혀 `.player-toolbar` 한 줄(44px)만 `.player-wrapper` 전체가 된다 — 버튼만 있던 같은 줄 왼쪽에 "▶ 현재 파트 + 현재 재생 시각"(`.player-mini-bar-text`, 예 "▶ Part 2 · 3:12")이 나타난다.
- **임베드 불가 파트가 현재 파트일 때도** 접힌 바가 44px를 넘지 않는다: `.player-wrapper.is-collapsed .player-media`는 `overflow: hidden`, `.player-wrapper.is-collapsed .player-placeholder`는 `display: none`이다 — 44px보다 큰 플레이스홀더가 "펼치기" 버튼을 덮던 결함(혼합 세션)을 막는다.
- iframe은 접힌 상태에서도 DOM에서 유지한 채 `.player-media`만 높이 0으로 줄인다(재생 유지) — 뗐다 붙이면 `iframe` 재로드로 재생 위치를 잃는다.
- **접힘 상태는 in-page 상태다**(영속 저장소 없음) — 새로고침·재진입 시 항상 펼쳐진 기본 상태로 시작한다.
- 버튼·툴바 탭 영역은 44×44px 이상(§13)이며, 마크업(§4 골격)엔 항상 존재하되 1024px 이상에서는 `.player-toolbar`/`.player-collapse` 둘 다 `display: none;`로 CSS만 숨긴다 — 데스크톱은 이 기능으로 바뀌지 않는다.

### 카드의 `scroll-margin-top` (1024px 미만 전용)

목차 클릭으로 카드에 스크롤할 때 sticky 플레이어에 카드 상단이 가려지면 안 된다.

```
.card { scroll-margin-top: calc(var(--sticky-player-h) + var(--space-4)); }
```

`--sticky-player-h`는 플레이어 래퍼의 실측 높이(뷰포트 폭에 따라 `min(56.25vw, 200px)`이
달라지고, 접힌 상태에서는 `44px`)를 `ResizeObserver`로 측정해 루트 요소에 세팅하는 CSS
커스텀 프로퍼티다. 1024px 이상에서는 플레이어가 `.side-col` 자체 스크롤 안에 있어 `.main`의
카드와 겹치지 않으므로 이 계산 자체가 필요 없다(미디어 쿼리 안에서만 값을 세팅·사용한다).

### 깊이/표면

전략은 v1과 동일하다: **보더 우선, 그림자는 sticky 플레이어 1곳에만**. 비인터랙티브 요소
(카드/이미지/figure)는 `1px solid var(--line)`(1.25:1, 장식용)로, 인터랙티브 컨트롤(입력·칩·
pill·버튼·part 전환 버튼·details summary)은 `1px solid var(--line-strong)`(3.45:1, §2·§13)로
구분한다. 그림자는 `.player-wrapper`만 `box-shadow: 0 2px 8px rgba(20,24,28,0.08)`를 쓴다.

## 5. 카드 해부 (노트 v2)

카드 루트는 `<article class="card" data-video data-start data-pos data-topics data-member-ids data-named-ids data-mention-ids data-related-ids data-position-target-ids data-addressed-to-all data-addressed-member-ids>`. `data-member-ids`는 `member_ids`(피드백이 행동 변화를 요구한 사람 = 지적·지시를 받은 선수)를, `data-named-ids`는 `named_member_ids`(소스 줄에 이름·별칭·게이머태그가 나온 선수, 스크립트가 계산, 칭찬·장면의 계기·수신자 포함)를, `data-mention-ids`는 둘의 합집합(중복 없음, "이름이 나온 선수" 패싯의 매칭·개수 기준)을, `data-related-ids`는 `relatedMembers(unit)`(`member_ids` ∪ 포지션 관련, `data-member-ids`의 상위집합)을, `data-position-target-ids`는 "내 포지션 대상" 팀원 id — data.json 유닛의 `position_target_ids`(fc.ts가 플랜의 `group_positions`와 그 경기 `lineup`으로 계산: core.ts `positionTargetMembers`, 그 경기에서 `group_positions`와 `related()`로 겹치는 포지션을 뛴 팀원 중 `member_ids`에 없는 사람. 이름 없이 "수비 라인"처럼 포지션 단위를 행위자로 부른 유닛의 대상)를 `|`로 구분한 id 목록으로 담는다. `position_target_ids`가 없는 옛 data.json은 이름 있는 변환 함수 `positionTargetIdsFromLegacyData`(`member_ids`가 비면 `related_member_ids`, 아니면 빈 값)가 읽는다. 카드는 `data-group-member-ids`(data.json 유닛의 `group_member_ids`: 그 경기 `lineup`에서 유닛의 `group_positions` 포지션을 뛴 팀원 전부, **고칠 사람 포함** — core.ts `groupMembers`, `position_target_ids`는 여기서 `member_ids`를 뺀 것이고 그 뜻은 바뀌지 않는다)도 싣는다. 이 필드가 없는 옛 data.json은 `groupMemberIdsFromLegacyData`가 `position_target_ids`(그것도 없으면 위 변환)로 읽는다 — 옛 데이터는 고칠 사람이 그룹에 뛰었는지 기록하지 않았다. 반복 지적의 팀 단위 칩(§6a)이 이 목록을 쓴다 — `data-pos`/`data-topics`도 같은 구분자다. `data-addressed-to-all`은 `unit.addressed_to_all`을 `"true"`/`"false"` 문자열로 그대로 담는다(`data-embeddable`과 같은 관례, 항상 명시). `data-addressed-member-ids`는 그 `addressed_to_all` 유닛이 닿는 팀원 id 목록이다(`addressedMemberIds`): 그 유닛이 속한 경기에 뛴 팀원 — 그 경기 `data.matches[].lineup`(팀원 id → 포지션)에 키가 있거나, 포지션을 몰라 lineup에 없더라도 그 경기 어느 유닛의 `named_member_ids`에 있는(원문에 이름이 불린) 팀원 — 만이고, `lineup`이 `null`이거나 없는 경기(옛 `data.json`, 이름 있는 변환 함수 `lineupFromLegacyData`)는 명단 전원이다. `addressed_to_all`이 아닌 유닛은 빈 값이다. "내 피드백"의 집계·선택·묶음은 `data-addressed-to-all`이 아니라 이 목록으로 판단한다(§6) — 그 경기에 뛰지 않은 팀원에게는 전원 대상이 닿지 않는다. 주제 태그는 공백을 포함할 수 있어(`core.ts`의 `isValidTag`) 공백 구분자는 단독 선택 시 매칭이 깨지므로, 태그에 쓸 수 없는 `|`를 쓴다. 멘션 배지(아래 3번)는 이 목록에서 id 존재만 확인하면 된다. 링크 전용 세션(§4, §9)에서는 카드 영역 클릭이 seek를 시도하지 않는다(VIEWER_JS가 `data-link-only`를 보고 즉시 반환). 클릭해도 아무 일이 없으므로 `body[data-link-only] .card`(와 본문 프레임)는 `cursor: pointer`를 쓰지 않고 `cursor: auto`다(링크·버튼 자체의 포인터는 그대로). `a`/`button`/`summary`/`figure` 태그가 아닌 카드 영역 클릭은 그 카드의 시작 시각으로 `seek`한다(카드 전체가 클릭 타깃, §13 탭 타깃 44px 규칙). 링크 전용 세션에서는 헤더 줄·본문 프레임의 시간 칩이 `<a class="chip chip-time seek-btn" href="https://youtu.be/<video>?t=<floor(초)>" target="_blank" rel="noopener">`(보이는 라벨 "m:ss ↗", `aria-label` "m:ss부터 유튜브에서 보기")인 진짜 링크다 — 프레임 칩은 그 프레임의 `t`를 가리킨다. 같은 세션에서는 본문 프레임 `<img>`도 그 칩과 같은 `youtu.be ... ?t=` 링크
`<a class="frame-link" target="_blank" rel="noopener">`로 감싼다(`alt` 유지) — 임베드 플레이어가 없으니 그림을 눌러도 유튜브 그 시각으로 간다.
임베드 가능한 세션의 프레임 이미지는 감싸지 않는다(figure 클릭이 seek). 그 외에는 헤더 줄(1번)의 시간 칩이 `<button class="seek-btn">`(예 "0:30부터 재생")이라 키보드로도 같은 seek를 실행할 수 있다 — 카드 자체는 포커스 불가 요소라 탭 스톱을 늘리지 않으면서 키보드 접근을 보장한다(§13). 단 `window.getSelection().toString()`이 비어 있지 않으면(사용자가 카드 안 텍스트를 드래그 선택 중이면) 그 클릭에서는 `seek`를 실행하지 않는다 — 문장을 드래그해 복사하려는 조작을 방해하지 않기 위함이다(§13).

`named_member_ids`는 plan.json에 쓰지 않는다 — `core.ts`의 `namedMemberIds`가 유닛의 `start_line..end_line` 줄 `text`(댓글 `author` 제외)에서 로스터의 `name`·`aliases`·`gamertag` 부분 문자열(라틴 대소문자 무시, 한글 조사는 부분 문자열이라 무관)을 찾아 로스터 순서로 계산해 `plan.validated.json`과 세션 `data.json` 유닛에 싣는다(명단 없음·disabled 모드는 `[]`). `named_member_ids`가 없는 옛 `data.json`은 이름 있는 변환 함수 `namedMemberIdsFromLegacyData`가, 옛 `plan.validated.json`은 `fc.ts`의 `namedMemberIdsFromLegacyValidated`가 `member_ids`를 그 값으로 읽는다(옛 데이터에서 `member_ids`는 "소스에서 불린 이름"이었다).

카드 내부 순서:

1. **헤더 줄**: 시간 칩(▶ 아이콘 + `m:ss`/`h:mm:ss`, 3600초 기준 분기) + 파트 칩(다중 파트
   세션에서만) + 브레드크럼(`경기 › 주제`, 댓글 유닛은 뒤에 "· 댓글 작성 이름"이 이어진다 — 2번, `›`는 `aria-hidden`이고 NBSP로 주제 글자와 이어 `.breadcrumb-topic` 안에 둔다 — 경기 제목과는 보통 공백으로 나뉘어 어느 줄도 `›`로 끝나지 않는다. `text-wrap: balance`로 마지막 단어 하나만 다음 줄에 홀로 남지 않게 한다). **≤640px**에서 브레드크럼은 `flex-basis: 100%`로 자기 줄 전체 폭을 쓴다 — 긴 브레드크럼이 시간 칩 옆에서 구절 중간에 줄바꿈되고 칩만 홀로 남던 문제(g13 시각 리뷰). 전부 Label 크기(13px)로
   작게 유지해 시각적 무게가 제목·본문(2·7번)에 쏠리게 한다.
2. **제목**: `<h3>` 유닛 제목. 제목 아래 줄의 순서는 **자료 교훈 줄 → 고칠 행동 없음 줄 → 장면 줄**이다(행동이 제목 바로 다음에 온다). **고칠 행동 없음 줄**: 제목의 " / " 조각이 모두 -ㅁ(지적, `isFaultTitleSegment`)이고 그 유닛에 붙은 어느 참고자료도 `lesson_ko`를 주지 않으면(`units[].refs[].lesson_ko`가 전부 `null`) 제목 바로 아래 `<p class="no-action">피드백에 고칠 행동은 적혀 있지 않다 — 장면 줄 참고</p>`를 렌더한다(`.fault-scene`과 같은 0.875rem·행간 1.7·`--muted`, 머리말 없는 한 문장 — 독자가 "그래서 뭘 고치지?"를 찾지 않게 한다). 데이터에서 정해지므로 새 필드가 없다. 장면 줄이 없는 카드(`fault_scene`이 `null`, `direction_check_ko` 카드)는 가리킬 장면 줄이 없으므로 "피드백에 고칠 행동은 적혀 있지 않다"까지만 렌더한다. -기 조각이 하나라도 있거나 `lesson_ko`가 있으면 렌더하지 않는다. 댓글 작성자는 제목 아래 별도 줄이 아니라 헤더 줄(1번)의 브레드크럼 안에 붙는다 — **카드 머리 줄 병합**: 댓글 피드백 유닛(`comment_author_names`가 비어 있지 않음)은 `<span class="breadcrumb">경기 › 주제<span class="card-source"><span aria-hidden="true">· </span>댓글 작성 이름, 이름</span></span>`("1경기 · … › 수비 조직 · 댓글 작성 뎁스차저")로 렌더한다(Label 크기·`--muted`는 브레드크럼 그대로, 별도 행이 없어 폰에서 카드 위쪽 높이가 한 줄 줄어든다. "댓글 피드백 · 이름"은 이름이 피드백 대상으로 읽혀 "작성"으로 바꿨다). `.card-source`는 `display: inline-block`이라 구분점 `· `이 줄 끝에 홀로 남지 않고 한 덩어리로 줄바꿈하며, 이름 목록이 길면 그 안에서만 감긴다. 경기·주제를 모르는 카드(`match`/`topic` 없음)는 구분점 없이 `댓글 작성 이름`만 브레드크럼 자리에 렌더한다 — 어느 경우든 **댓글 카드에서 항상 보인다**. 음성 피드백 유닛은 렌더하지 않는다(발화자 줄 없음, 이전과 같다). **방향 확인 줄**: notes 유닛의 선택 필드 `direction_check_ko`(1–100자 한 줄, 소스의 좌/우와 프레임이 어긋난다는 한 문장 — `data.json` `units[].direction_check_ko`, 없으면 `null`, 옛 데이터는 `directionCheckFromLegacyData`가 `null`로 읽는다)가 있는 유닛은 `fault_scene`을 가질 수 없고(`check notes`가 거부, -ㅁ 제목의 `fault_scene` 필수도 면제) 따라서 "장면 ·" 줄이 없다. 이 줄은 그 자리에 `<p class="direction-check"><span class="line-label">방향 확인 필요 ·</span> …</p>`를 렌더한다(0.875rem·행간 1.7·`--ink`, 머리말만 기존 토큰 `--pos-gk-fg`로 경고색, `titleHtml`로 이스케이프). 캡션은 "댓글은 …" 문장을 쓸 수 없다(`check notes`가 거부) — 어긋남은 이 줄로만 보인다. **장면 줄**: 제목에 -ㅁ(지적) 조각이 있는 유닛은 `units[].fault_scene`(notes의 `fault_scene`, 1–120자 한 줄 — 그 잘못이 유닛 프레임에서 어떻게 보였는지: 누가 어디에 섰고 대형이 어떻게 갈렸는지)을 자료 교훈 줄 바로 아래(교훈 줄이 없으면 제목 바로 아래) `<p class="fault-scene"><span class="line-label">장면 ·</span> …</p>`로 렌더한다(`titleHtml`로 이스케이프, 보조 글자 크기 14px(`0.875rem`, §2 Caption)·행간 1.7·`--muted` 색 — 카드 상단이 폰 폭에서 무거워 본문이 제목 아래 400px 가까이에서 시작하던 문제(390px 시각 리뷰)를 줄이려고 본문 17px보다 한 단계 작게 한다). `fault_scene`이 `null`(제목에 -ㅁ 조각이 없음)이면 줄을 렌더하지 않는다. **자료 교훈 줄**: 그 유닛에 붙은 참고자료(`units[].refs[]`) 중 `lesson_ko`가 `null`이 아닌 첫 자료가 있으면 **제목 바로 아래, 장면 줄 앞**에 `<p class="ref-lesson"><span class="line-label">자료가 권하는 것 ·</span> <교훈> <span class="ref-lesson-cite">(<a class="ref-lesson-source" href="#<유닛id>-ref-<자료id>">자료 출처 이름</a>)</span></p>`를 렌더한다(`titleHtml`, 장면 줄과 같은 14px·행간 1.7이고 색은 `--ink`라 대비를 유지한다). 장면 줄이 "이 카드의 잘못이 프레임에서 어떻게 보였나"인 것과 달리 이 줄은 **참고자료 자신이 권하는 행동**이라 줄 머리말과 괄호 출처 이름으로 자료의 말임을 밝히고 댓글 작성자의 말과 섞지 않는다. **줄 머리말 통일**: 장면 줄과 교훈 줄은 같은 "<머리말> ·" 꼴(구분점 `·`, 콜론 아님)과 같은 `.line-label` 스타일(굵기 600·`--ink`·`white-space: nowrap`)을 쓴다 — 머리말만 `--ink`로 굵게 두어 두 줄이 같은 종류의 줄로 읽히고(교훈 줄은 본문도 `--ink`, 장면 줄 본문은 `--muted`), 첫 훑기에서 머리말이 구별점이 된다. 출처 링크는 같은 카드 참고자료 목록의 그 자료 `<li id="<유닛id>-ref-<자료id>">`로 이동하며 44px 탭 영역은 `.ref-link`(§5 10번)와 같은 기법 — `position: relative`인 `<a>`에 가운데 정렬 `::after`(`width: max(100%, 44px); height: 44px; transform: translate(-50%, -50%)`) — 이고 `min-height`/`inline-flex`를 쓰지 않는다(`min-height: 44px`가 문단 줄 높이를 68px로 키워 빈틈을 만들던 결함). **괄호 한 덩어리**: "(출처)"는 `.ref-lesson-cite`(`display: inline-block; max-width: 100%`)로 감싸 390px에서 여는 괄호 `(`가 줄 끝에 홀로 남지 않게 하고(통째로 다음 줄로 내려가고, 한 줄보다 길면 그 안에서만 감긴다), 링크는 inline이라 괄호와 이름 사이에 줄바꿈 기회가 없다. 값은 refs-draft `lesson_ko`(유닛별 1–80자)가 `verify-refs`·`data.json`을 거쳐 온 것이고, 자료에 `lesson_ko`가 없는 옛 데이터는 이름 있는 변환 함수 `lessonFromLegacyData`(`null` → 줄 없음)로, `source_name`이 없는 옛 데이터는 `sourceNameFromLegacyData`(자료 제목)로 읽는다. 필드가 없는 옛 `data.json`은 이름 있는 변환 함수 `faultSceneFromLegacyData`가 `null`로 읽는다. 카드 하나만 연 독자도 그 조언이 팀원의 댓글에서 왔음을 알아야 하므로(사용자 요구 "카드마다 작성자 표시") **댓글 유닛의 카드는 항상 머리 줄에 작성자를 렌더한다** — 세션의 모든 유닛이 같은 한 명의 `comment_author_names`(길이 1, 같은 이름)여도 생략하지 않는다. 그 경우에는 세션 헤더(제목·날짜 아래)에도 같은 문구를 한 번 더 렌더한다(`sharedCommentAuthor`). 헤더의 그 문구는 `<p class="feedback-source">`(`p.feedback-source` 규칙)이고 카드 쪽은 `.card-source`다. 작성자가 유닛마다 다르거나 일부 유닛이 비었거나 여러 명이면 카드별 표기만 쓰고 헤더에는 없다.
3. **멘션 배지**: "내 피드백"(§6)에서 팀원을 선택했을 때만 제목 바로 아래 배지 1개를
   보인다 — `data-member-ids`에 있으면 "고칠 점"(`background: var(--accent); color:
   var(--bg);` 채움)이 최우선이고, 아니고 `data-position-target-ids`에 있으면 "내 포지션 대상"(이름을 부르지 않고 내 포지션 전체에 한 말, `--mine-tint` 토큰), 아니고 유닛이
   `addressed_to_all`이면 "전원 대상"(`background: var(--bg); color: var(--muted);
   border: 1px solid var(--line);` 아웃라인), 아니고 `data-named-ids`에 있으면 "이름이 나온 장면"
   (`background: var(--mine-tint); color: var(--ink);`), 그 넷 다 아니지만 `data-related-ids`에는 있으면
   "같은 포지션 참고"(같은 아웃라인 스타일, 다른 사람의 개별 지적에 내 포지션만 겹친 경우) — 우선순위는 §6의 그룹 순서와 같다. 채움 vs 옅은 채움 vs 아웃라인으로 고칠 점·내 포지션 대상·이름이 나온 장면·참고용을 한눈에 구분한다. 문구는 §6의 묶음 제목과 같다.
   **이름 나옴 병기**: "내 포지션 대상"·"전원 대상"인 카드에서 선택한 팀원이 `data-named-ids`에도 있으면(소스가 그 이름을 불렀으면) 문구 뒤에 " · 이름 나옴"을 붙여("내 포지션 대상 · 이름 나옴", "전원 대상 · 이름 나옴") 우선순위 때문에 이름이 불린 사실이 가려지지 않게 한다. "고칠 점"(고칠 사람은 거의 항상 소스에서 불린다)에는 붙이지 않는다. 미선택 상태에서는 렌더하지 않는다.
4. **대표 시작 이미지**: `<img>`에 실제 프레임의 width/height로 레이아웃 시프트를 막는다.
   클릭 시 시작 시각으로 seek(카드 공통 클릭 규칙). 폭은 `.card` 전체 폭(§2 `--measure`).
   figcaption은 태그 행(5번)과 한 줄 공유 — 태그 왼쪽, "확대"(새 탭 원본 링크) 오른쪽
   (`justify-content: space-between`), 태그가 다음 줄로 밀리는 2줄 배치는 금지(§15-10).
   **본문 프레임이 있으면 시작 이미지를 렌더하지 않는다**: 시작 이미지는 캡션이 없다. 본문 프레임 블록(`type: "frame"`)이
   **하나라도** 있으면 그 시각이 `unit.start`와 같든 다르든 시작 이미지 `<figure class="card-image">`를 렌더하지 않는다
   (시각이 같으면 바이트 단위로 같은 그림이고, 다르면 캡션 없는 이미지가 본문 앞에 홀로 놓여 무엇을 보라는 것인지 알 수 없다 —
   u030/u036 시각 QA). 시작 이미지는 본문 프레임이 없는 유닛에서만 나온다. 이때 태그 행(5번)은 figure의 figcaption 안이 아니라 같은
   자리(멘션 배지 다음, "고칠 사람" 줄 앞)에 단독 `.chip-row`로 렌더한다.
   **초광각 프레임(4a)**: 시작 이미지와 본문 프레임 이미지 공통. width/height 비가 2를 넘으면(예 32:9 1280×360, 1920×540)
   `<img width height>`를 `<div class="frame-pan"><div class="frame-pan-scroll" data-pan-center="0.5">…<img>…</div><p class="frame-pan-hint" hidden>좌우로
   밀어 보기</p></div>`로 감싼다(2:1 이하는 감싸지 않는다). **전체 프레임이냐 이동 상자냐는 폭이 아니라 그려질 높이로 정한다**: VIEWER_JS `fitPanBoxes`가 `pan.clientWidth × height/width ≥ 280`(`FULL_FRAME_MIN_HEIGHT`)이면 `.frame-pan`에 `frame-pan--full`을 붙여 프레임 전체를 `width: 100%; height: auto`로 보이고(이동 힌트 없음), 아니면 이동 상자로 둔다 — 전체를 그리면 선수와 이름표가 점이 되는 폭에서는 폭과 무관하게 상자다(예전 "≥1024px면 전체 폭, 카드를 오른쪽으로 넓힘"은 1920×540이 612px 컬럼에서 195px로 줄어 이름표를 읽을 수 없어 없앴다 — `card--ultrawide`·`hasUltrawideFrame`도 함께 삭제). 이동 상자(`frame-pan--full`이 없을 때)는 `.frame-pan-scroll`이 `overflow-x: auto; overflow-y: hidden`이고 이미지는 상자 높이 100%·자연 폭(`width: auto; max-width: none`)이며 **모든 폭에서** 높이는 ≤640px 280px, >640px 300px이다(폭에 비례시키면 390px에서 218px까지 줄어 이름표가 점으로 보인다). 위치는 `focus_x`가 정한다(아래 시작 위치). **힌트는 마크업에서 `hidden`이고** `refreshPanBoxes`(= `fitPanBoxes` 후 중앙 맞춤)가 정한다: 이미지가 상자를 **실제로 잘라 내는**(`scrollWidth - clientWidth > 1` — 1px 이하 반올림 차이는 자름이 아니다 — 이고 `frame-pan--full`이 아닌) 프레임 중 **카드마다 DOM 순서상 첫 번째 하나**의 힌트만 보인다. 힌트 글은 `finePointer()`(`matchMedia("(pointer: fine)")`)면 "끌어서 좌우로 보기", 아니면 마크업의 "좌우로 밀어 보기"다. `refreshPanBoxes`는 시작 시, `resize`마다, 이미지 `load`마다, 필터가 숨겼던 카드가 다시 보일 때마다(숨은 카드의 상자는 폭이 0) 돈다. CSS는 `.frame-pan .frame-pan-hint[hidden] { display: none; }`로 `display: block`에 `hidden`이 눌리지 않게 한다. 페이지 자체는 가로로 스크롤되지 않는다(390/1024/1280/1440px 실측: 카드 오른쪽 끝 = 패널 오른쪽 끝, 초광각 프레임 높이 280/300/300/300px).
   **시작 위치**: 노트의 프레임 블록은 선택 필드 `focus_x`(0 이상 1 이하 숫자, 프레임 왼쪽 끝 0·오른쪽 끝 1 — 캡션이 가리키는 대상의 가로 위치)를 가질 수 있다(`check notes`가 범위 밖·비숫자를 거부하고, `fc render`가 data.json의 body 프레임 `focus_x`로 그대로 옮긴다; 없으면 필드를 만들지 않는다. 캡션이 화면 방향("화면 왼쪽/오른쪽/좌측/우측", "왼쪽 끝", "오른쪽 끝")을 말하는데 `focus_x`가 없으면 `check notes`가 stderr 경고를 낸다 — 오류가 아니며 `noteWarnings`가 낸다). 렌더러는 이름 있는 변환 하나(`panCenterFromFocus`: `focus_x`가 없으면 0.5, 있으면 그 값)로 이동 상자의 `data-pan-center`(상자 가로 중앙에 올 이미지 폭의 비율)를 정한다 — 기본값 0.5는 이 함수에만 있고 어디에도 센티널로 저장하지 않는다. 시작 이미지는 `focus_x`가 없어 항상 0.5다.
   VIEWER_JS가 시작 시, `resize`마다, 이미지 `load`마다(로드 전엔 `scrollWidth`가 0), 필터가 숨겼던 카드가 다시 보일 때마다(숨은 카드의 상자는 폭이 0)
   각 상자의 `scrollLeft`를 `data-pan-center * scrollWidth - clientWidth / 2`로 맞추되 `0 ~ scrollWidth - clientWidth`로 자른다(0.5면 가로 중앙). 사용자가 민 상자(`scroll` 이벤트 시점의 `scrollLeft`가 스크립트가 맞춘 값과 다른 상자)는 다시 옮기지 않는다. 힌트 선택자는 `.frame-pan .frame-pan-hint`로 한정한다 — 본문 프레임 안에서는 `.card-body p`(17px)가 이기지 못하게 13px를 지킨다.
   **마우스 끌기(데스크톱)**: 마우스는 스와이프가 없고 상자에 스크롤바도 보이지 않아 1440px에서 1920×540 프레임이 상자 안에 ~54%만 보이는데도 옮길 수 없었다. 잘린 상자에는 `centerPanBoxes`가 `data-pannable`을 두고, `(pointer: fine)`에서 그 상자는 `cursor: grab`(끄는 중 `.is-dragging`: `grabbing`·`user-select: none`)이다. VIEWER_JS는 상자의 `pointerdown`(마우스 주 버튼, 고정밀 포인터, `data-pannable`일 때만)에서 시작 x와 `scrollLeft`를 기록하고 문서의 `pointermove`가 `scrollLeft = 시작값 - 이동량`으로 옮기며 `pointerup`/`pointercancel`이 끝낸다. 포인터 캡처는 쓰지 않는다 — 캡처하면 클릭이 프레임 링크가 아니라 상자로 가 단순 클릭이 YouTube를 열지 못한다. 4px(`PAN_DRAG_THRESHOLD`) 이상 끌었으면 그 끝의 `click`을 상자의 캡처 단계에서 막고(링크·카드 클릭 모두), 4px 미만이면 그대로 둔다. 이미지 기본 끌기(`dragstart`)는 막는다. 터치는 위 포인터 조건에 걸리지 않아 기존 스와이프 그대로다. 끈 상자는 `fcUserScrolled`가 되어 이후 중앙 맞춤이 다시 옮기지 않는다.
   프레임 클릭 seek는 그대로 동작한다(상자 안에서 손가락으로 미는 조작은 click을 만들지 않는다).
5. **태그 행**: 포지션 칩(`position_tags`, 루트 그룹 GK/DF/MF/FW 색) + 주제 칩(중립,
   `--surface-sunken` 배경)을 원래 순서대로 이어 붙여 **최대 6개만 보이고**, 나머지는 `+N`
   칩(중립색, 클릭 불가, 순수 카운트 표시) 하나로 묶는다. `@멘션` 칩은 이 행에 넣지 않는다
   (다음 항목으로 분리). 4번 이미지의 figcaption 안에 렌더되지만(본문 프레임이 있어 시작 이미지가 생략되면 단독 행으로) 필드 순서는 그대로다.
6. **고칠 사람 · 언급**: `member_ids`의 팀원을 이름으로 나열한다("고칠 사람: 한지우, 윤도훈").
   그 바로 아래에 `named_member_ids \ member_ids \ position_target_ids`(이름만 나왔고 "고칠 사람"·"대상(포지션)" 줄에 아직 보이지 않은 선수)를 "언급: 이름, 이름"으로
   나열한다(`namedOnlyIds` — "대상(DF, CB): 게임메이커, 동그리" 아래에 "언급: 동그리"가 되풀이되지 않는다)(`<p class="mentioned-members named-members">`). 두 줄 모두 비어 있으면 렌더하지 않는다
   (disabled 모드에서도 항상 생략, §10). 포지션과
   무관하게 모두에게 통하는 말을 담은 유닛(`addressed_to_all: true`)은 이 줄 바로 아래에
   "대상: 전원" 칩(멘션 배지의 "같은 포지션 참고"와 같은 아웃라인 토큰 재사용, 새 색 없음)을
   추가로 렌더한다 — roster 유무와 무관하게(disabled 모드에서도) 렌더하며, "고칠 사람:" 줄과
   함께 올 수 있다(고칠 사람의 장면을 예로 들며 모두에게 원칙을 말하는 경우). **전원이 아닌 대상**: 제목의 첫 ":" 앞 행위자 문구가 "전원"이 아니면(예 "키 작은 선수: 헤딩 경합을 피함") "대상: 전원" 대신 그 문구("대상: 키 작은 선수")를 보인다. ":"가 없거나 앞이 비어 있으면 "전원"이다(`addressedActor`).
   **대상 포지션 줄**: `addressed_to_all`이 아닌 유닛에 `position_tags`가 있으면 `member_ids`가 있든 없든 독자가 누구에게 하는 말인지 알 수 있도록("고칠 사람:" 줄과 공존), 같은 자리·같은 스타일(`.chip-target-position`, "대상: 전원"과 같은 아웃라인 토큰)로
   `<p class="target-position-line">`에 "대상: `position_tags`를 ', '로 이은 값"(예 "대상: DF")을 렌더한다.
   `position_tags`가 비어 있으면 이 줄을 렌더하지 않는다. roster 유무와 무관하다.
   **생략 규칙**(`renderTargetLine`): 이 줄은 바로 위 태그 행의 포지션 칩과 같은 말이므로, 이미 대상을 말하는 줄이 있고 포지션이 태그 행에 모두 보이면 생략한다. 곧 (a) "고칠 사람" 줄이 보이거나(`member_ids`가 있고 roster 있음) 아래 "대상(포지션): 이름" 줄이 보이고(`position_target_ids`가 있고 roster 있음), (b) `position_tags`가 태그 행 상한(6개, 5번 — 포지션 칩이 맨 앞에 오므로 6개 이하면 전부 보인다) 이하일 때만 생략한다. 그 외(고칠 사람도 포지션 대상 이름도 없음, roster 없음 = disabled, 포지션 태그가 7개 이상으로 칩이 `+N`에 잘림)에는 줄이 남아 누구에게 하는 말인지 알려 준다. `addressed_to_all` 유닛의 "대상: 전원" 칩은 항상 렌더한다.
   **한 줄 병합**(`renderFixerAndPositionTargetLines`): 카드에 "고칠 사람" 줄과 "대상(포지션): 이름" 줄이 둘 다 있고 대상 이름이 인라인 한도(`MAX_RELATED_INLINE`, 5명) 이하면 한 `<p class="mentioned-members">`로 합친다 — "고칠 사람: 뎁스차저 · 대상(DF, CB): 우사, 동그리". `· 대상(…): …`는 `.position-target-part`(`display: inline-block; max-width: 100%`) 한 덩어리라 좁은 폭에서 `·`가 줄 머리로 가고 이름 목록이 길면 그 안에서만 감긴다(390px에서 두 줄이 되어도 별도 문단 사이 여백이 없다). 고칠 사람이 없거나 대상이 6명 이상(`<details>`)이면 아래처럼 따로 선다.
   **포지션 대상 줄**: `position_target_ids`(필수 행동 대상 — 이름 없이 포지션 단위를 행위자로 부른 유닛에서 그 포지션을 그 경기에 뛴 팀원)가 있으면 "고칠 사람" 줄 아래, "언급" 줄 위에 `<p class="related-members position-target-members">대상(DF, CB): 게임메이커, 동그리</p>`(괄호 안은 `position_tags`를 ', '로 이은 값, 비면 괄호 생략)를 렌더한다. "같은 포지션:" 줄(8번)과 같은 이름 목록 렌더러라 6명 이상이면 같은 `<details>` 접힘을 쓰고, "내 피드백"의 이름 강조(`<mark class="member-name">`)·자동 펼침도 같다. roster가 없으면(disabled) 렌더하지 않는다.
   **작성자 본인 지적**: 유닛 댓글 작성자가 그 유닛의 `member_ids` 팀원이면(`self_critique_member_ids`) 카드가 남이 그 사람을 탓하는 것으로 읽히므로 "고칠 사람" 줄에서 그 이름 바로 뒤에 `<span class="self-critique-mark">&nbsp;(작성자 본인)</span>`(`--muted`, 굵기 400, `white-space: nowrap`)을 붙인다("고칠 사람: 뎁스차저 (작성자 본인), 우사"). 표지는 U+00A0로 시작하므로 이름과 갈라져 "(작성자 본인)"만 다음 줄로 내려가지 않고, nowrap이라 표지 안에서도 줄이 바뀌지 않는다(g23 u027 "뎁스차저 ⏎ (작성자 본인)"). 작성자 이름은 이미 제목 아래 "댓글 작성 · 이름" 줄(2번)에 있으므로 별도 줄은 두지 않는다 — 이름이 세 줄에 쌓이던 메타 높이를 줄인다. 필드는 data.json 유닛의 `self_critique_member_ids`(`member_ids`의 부분집합, 스크립트가 `core.ts` `selfCritiqueMemberIds`로 계산: 유닛 `comment_authors` handle을 `commentAuthorMember`가 로스터 멤버로 풀어 — 이름·게이머태그·별칭, 유튜브 `-접미사` 허용, `commentAuthorName`과 같은 규칙 — `member_ids`와 겹치는 id)다. 필드가 없는 옛 `data.json`은 이름 있는 변환 함수 `selfCritiqueMemberIdsFromLegacyData`가 `[]`로 읽는다.
7. **본문**: `unit.body`(blocks 배열)를 작성 순서 그대로 렌더한다. 노트 dl(문제/누구/대신)은
   v2에서 완전히 폐기한다.
   - `{type:"text", text}` → `<p>`. `text`를 escape한 뒤 `**굵게**`만 `<strong>`으로 바꾼다.
     그 외 마크다운(이탤릭, 링크, 목록 등)은 변환하지 않고 문자 그대로 남긴다. 개행은
     블록 경계로만 쓰고 블록 내부 `\n`은 없다(블록 하나 = 문단 하나).
   - `{type:"frame", src, width, height, t, caption, focus_x?}` → `<figure class="body-frame"
     data-frame-t="{t}"><img src width height loading="lazy"><figcaption>{시간 칩,
     `.seek-btn` 버튼}<span class="body-frame-caption">{caption}</span><a href="{src}"
     target="_blank" rel="noopener" class="zoom-link" aria-label="확대: m:ss 프레임
     원본">확대</a></figcaption></figure>`. 폭은 `.card`/`.main` 전체 폭(§2 `--measure`).
     figcaption은 `auto minmax(0,1fr) auto` 3열 그리드 — 시간 칩·"확대"는 고정 폭, 캡션만
     가운데 열에서 줄바꿈되며 상단 정렬 유지(`align-items: start`) — 캡션 길이에 따라 셋이
     1~4줄로 흩어지던 결함(§15-10)을 막는다. **≤640px**에서는 중간 열이 좁아(시간 칩 | 캡션 | 확대에 ~195px) 캡션이 4~5줄로 늘고 조사가 줄 머리로 고아가 되므로, figcaption을 `auto 1fr` 2열로 바꿔 시간 칩(왼쪽)·"확대"(오른쪽)를 첫 줄에 두고(`align-items: center`로 둘의 세로 가운데를 맞춘다 — 데스크톱의 `start` 정렬 그대로면 작은 칩과 44px 확대 링크가 어긋나 보였다) `.body-frame-caption`을 `grid-column: 1 / -1`로 둘째 줄 전체 폭에 놓는다. `aria-label`은 보이는 글자 "확대"로 시작해야 하므로(접근 가능한 이름이 보이는 라벨을 포함, WCAG 2.5.3) "확대: m:ss 프레임 원본"이고 m:ss는 그 프레임의 `t`(시작 이미지의 확대 링크는 유닛 시작 시각)를 `formatTime`으로 쓴 값이다. `figure` 클릭은 `data-frame-t`로 seek한다(카드
     시작 시각이 아니라 **그 프레임의 시각**). **시각 칩 생략**: 프레임의 `t`가 유닛 시작과 같은 `m:ss`(`formatTime` 값이 같음)이면 카드 헤더 칩과 하단 링크가 이미 그 시각을 주므로 캡션 줄에 시각 칩을 렌더하지 않는다 — `<figure class="body-frame no-time-chip">`이고 figcaption은 `minmax(0,1fr) auto` 2열(캡션 | 확대; ≤640px에서도 같은 2열, 캡션이 첫 줄). `data-frame-t`와 figure 클릭 seek는 그대로다. "확대" 클릭은 버블링돼도
     `event.target.closest('a')`로 확인해 seek를 무시한다. 캡션은 필수(빌드 실패 검증)이며
     시각을 다시 쓰지 않는다(시각 칩이 이미 표시) — `check notes`는 시계·점수로 시작하는 캡션(`^\s*\d{1,2}:\d{2}`)을
     거부하고 경기 시간은 "경기 34분"처럼 말로 쓰라고 안내한다(칩 바로 옆에 라벨 없는 시각이 둘 놓이면 독자가 헷갈린다).
7a. **위치 미확인 인물**: `unidentified_member_ids`(고칠 사람 중 카드의 어떤 사진으로도 작성자가 누군지 알아볼 수 없는 로스터 id)가 비어 있지 않으면 본문(사진·프레임 포함) 바로 뒤에
    `<p class="unidentified-members">사진에서 위치를 확인하지 못한 사람: 게임메이커</p>` 한 줄을 Label 크기·`--muted` 색으로 렌더한다(이름은 `data.members`에서 찾고 없으면 id, 쉼표+공백으로 잇고 `titleHtml`로 이스케이프).
    비어 있으면 줄 자체를 렌더하지 않는다. 필드가 없는 옛 `data.json`은 이름 있는 변환 함수 `unidentifiedMemberIdsFromLegacyData`가 `[]`로 읽는다.
    notes 유닛의 `look_at`(고칠 사람을 알아볼 수 없을 때 사진에서 볼 곳, `unidentified_member_ids`가 비어 있지 않거나, 캡션이 받는 사람이 사진에 "보이지 않는다"고 말하면 필수 — 그 외에는 금지)이 data.json `units[].look_at`(`string | null`, 미식별자가 없으면 `null`)으로 오면 위치 미확인 줄 바로 아래 자기 줄 `<p class="look-at">사진에서 볼 곳: <look_at></p>`로 렌더한다(위치 미확인 줄과 같은 Label 크기·`--muted`, `titleHtml`로 이스케이프). 라벨 "사진에서 볼 곳"은 공백을 U+00A0로 묶어 줄 중간에서 갈라지지 않는다. 이전에는 위치 미확인 줄 끝에 ` · 사진에서 볼 곳: …`을 이어 붙여, 여러 사람 문장("동그리: … / 우사가 줄 곳: …")이면 라벨이 줄 사이에서 갈라지고 콜론이 겹쳐 읽혔다. 그래서 `check notes`는 `look_at`에 ":"나 " / "가 있으면 거부한다(볼 곳은 한 문장). 필드가 없는 옛 `data.json`은 이름 있는 변환 함수 `lookAtFromLegacyData`가 `null`로 읽어 붙이지 않는다.
8. **같은 포지션**: `relatedMembers(unit) \ member_ids \ named_member_ids \ position_target_ids`(집합 차, 이미 "고칠 사람"·
   "대상(포지션)"·"언급" 줄에 나온 사람은 다시 보여주지 않는다 — 포지션 대상은 행동해야 하는 사람이라 단순 참고와 섞지 않는다)를 이름으로 나열("같은 포지션: 이름, 이름"). 결과가 비면 이 섹션
   자체를 렌더하지 않는다. 5명 이하면 지금처럼 `<p>` 한 줄로 전원을 보이고, 6명 이상이면
   모바일 가독성을 위해 JS 없이 동작하는 `<details>`로 접어 앞 4명 + "외 N명"만 `<summary>`에
   보이고 나머지는 펼쳐야 보이게 한다. 펼치면 "외 N명"은 숨고 `<summary>` 끝에 쉼표가 붙어
   이어지는 나머지 이름들과 한 목록처럼 읽힌다. "내 피드백"(§6)에서 고른 팀원의 이름이 접힌 목록 안에
   있으면 강조가 가려지므로 자동으로 펼친다(선택 해제 시 다시 접지는 않는다). 접힘 요약(`<summary>`)은
   보이지 않는 확장 영역으로 최소 44px 탭 영역(§13)을 확보하되 텍스트 자체는 한 줄로 남아,
   펼치면 나머지 줄과 빈틈 없이 붙어 한 목록으로 읽힌다. 단 펼친 상태(`[open]`)에서는 이
   확장 영역의 아래쪽을 끈다 — 펼치면 나머지 이름 줄이 `<summary>` 바로 아래 붙으므로, 아래쪽을
   그대로 두면 그 줄 탭이 접힘 대신 카드 seek로 가야 할 조작을 가로챈다. 접힌 상태는 끝에 `▾`
   표시가 붙으며, "외 N명"은 줄바꿈되지 않는다.
9. **유사한 과거 피드백**: 있을 때만, 세션 날짜 + 링크(해당 세션의 유닛 앵커).
10. **참고자료**: 목록 앞에 보이는 라벨 `<p class="refs-label">참고자료</p>`(메타 블록 안, 목록이 있을 때만). 항목은 제목, 그 아래 자기 줄(`.ref-badges`, flex)에 형식 배지(`.badge.ref-format`, "영상"/"글" — `.badge`보다 특이성을 높여 `--surface-sunken` 배경·`--ink` 글자·굵기 700으로 종류·언어 배지와 구분 — `--mine-tint`·`--accent`는 다른 곳에서 "내 것"을 뜻하므로 쓰지 않는다), 종류·(프로클럽)·(버전)·(업로드 연월)·(언어) 배지(`kind`/`lang` — `kind`는 enum 값 그대로가 아니라 `refKindLabel` 한 곳의 매핑으로 한국어 표기: `eafc` → "EA FC", `tactics` → "축구 전술"; 순서는 형식 · 종류 · 프로클럽 · 버전 · 업로드 연월 · 언어, 모두 같은 `.badge` 스타일. 프로클럽 배지(`.badge-pro-clubs`, "프로클럽")는 `pro_clubs`가 true일 때만, 버전 배지(`.badge-version`)는 `version_badge`가 null이 아닐 때만 그 문구 그대로("FC 25 · 이전 버전", "FC 26") 보인다 — null은 게임이 아닌 자료이거나 버전을 밝히지 않은 자료다. **"버전 미표기" 문구는 렌더하지 않는다**: 버전을 밝히지 않은 자료는 버전 배지 없이 업로드 연월 배지(`.badge-published`, `published_badge` "2023년 1월")만 보인다(날짜를 모르면 둘 다 없다). **언어 배지는 `lang`이 "ko"가 아닐 때만** 보인다(한국어는 기본이라 "KO"를 달지 않는다). 세 필드가 없는 옛 `data.json`/`refs.verified.json`은 이름 있는 변환 함수 `versionBadgeFromLegacyData`(null, 옛 "버전 미표기" 문구도 null)·`publishedBadgeFromLegacyData`(옛 "2023년 1월 · 버전 미표기"에서 날짜만 읽음, 아니면 null)·`proClubsFromLegacyData`(false)가 읽는다),
    그 유닛에 대한 관련성 문장(`.ref-relevance`, 제목 아래 한 줄 블록, `--muted` 색), 링크. 위계: 제목(`.ref-title`)은 `font-weight: 600`, 항목 사이 간격은 `--space-3`(`.refs-list li + li`). 링크("요약"·"원문 ↗"·"자료 영상 m:ss부터 ↗")는 모두 `.ref-link`로 글자 크기는 그대로 두고 `min-width` 없이 내용 폭만 차지한다(예전의 `min-width: 44px`는 짧은 "요약" 뒤에 약 20px의 빈 틈을 만들어 "·" 구분자가 떠 보였다 — 390px 시각 리뷰). 링크들은 `<span class="ref-links">`(`display: flex; flex-wrap: wrap; gap: 0 var(--space-3)`) 한 행에 놓고 구분자는 `<span class="ref-sep" aria-hidden="true">·</span>`로 따로 둬, gap이 구분자 양옆 간격을 같게 만든다. 44px 탭 영역은 `::after`(`left: 50%; width: max(100%, 44px); height: 44px; transform: translate(-50%, -50%)`)가 링크 가운데를 기준으로 좌우·상하로 확장해 만들고, 짧은 "요약"의 확장분(좌우 각 약 8px)이 gap(12px) 안에 들어 인접 링크·구분자의 히트 영역과 겹치지 않는다(§13). `lang !== "ko"`면
    "요약"(→ `refs/<id>.html`) + 원문 링크(둘 사이에 보이는 " · " 구분자 — 밑줄 링크 둘이 한 링크로 읽히지 않게), `lang === "ko"`면 원문 링크만("요약" 링크 자체를
    렌더하지 않는다). 원문 링크는 "원문 ↗"이고, 시작 시각이 0보다 큰 영상이면 "자료 영상 m:ss부터 ↗" (카드 하단의 경기 영상 링크 "경기 영상 m:ss부터 보기 ↗"와 헷갈리지 않게 "자료 영상"을 앞에 둔다; 유튜브는 `t=<초>s`로 그 시각부터 연다). `start_seconds`가 0이면 "자료 영상 0:00부터"는 처음부터와 같아 정보가 없으므로 "원문 ↗"이고 `t=`도 붙이지 않는다(카드와 참고자료 페이지 공통, `refOpenLink`). "요약"을 포함해 모두 `target="_blank" rel="noopener"`.
11. **"경기 영상 m:ss부터 보기 ↗"**(`.watch-link`, m:ss는 유닛 시작 시각 — 1시간 이상이면 h:mm:ss, 헤더 시간 칩과 같은 포매터): `https://youtu.be/<videoId>?t=<startSeconds>`, 새 탭. 플레이어
    임베드 가능 여부와 무관하게 항상 렌더한다(JS 없이도 동작해야 하는 요구사항). 이전 문구 "유튜브에서 보기 ↗"는 바로 위 참고자료 목록 끝에 붙어 마지막 참고자료의 링크로 읽혔다 — "경기 영상"으로 이 카드의 영상 링크임을, 시각으로 어디부터 열리는지를 밝힌다. `::after`로 44px 히트 영역을 확장한다(§13).

### 본문 간격

제목(2번)→본문(7번) 첫 문단은 `--space-3`(12px), 문단 사이는 `--space-4`(16px), 문단→프레임
사이는 `--space-6`(24px)이다. 헤더 줄(1번)을 작게 유지하는 것과 합쳐, 시선의 무게가 태그·
메타가 아니라 제목→본문 흐름에 실리게 하는 것이 목적이다.

### 볼드 스타일

`<strong>`은 `font-weight: 700; color: inherit;`만 준다 — 색을 바꾸거나 배경을 깔지 않는다.
볼드는 "문장 안에서 가장 중요한 단어"를 표시하는 유일한 강조 수단이며, 그 외에 이탤릭·밑줄·
형광펜색 텍스트를 문단 안에 섞지 않는다(§1 원칙 2).

### 리드(두괄식) 작성 원칙

각 유닛의 첫 번째 text 블록은 핵심 장면을 한 문장으로 압축하고 그 안에서 다음 경기에 시도할 개선 행동을 **볼드**로 짚는다 — 문제/누구/대신 같은 고정 템플릿 라벨은 쓰지 않는 자유 문장이며(§0), 이 문단만 읽어도 무엇을 고쳐야 하는지 알 수 있어야 한다는 §1 원칙 1·2의 실행 규칙이다. 뒤따르는 문단과 프레임은 그 판단의 근거 장면과 디테일을 보탠다. **캡션은 그 프레임에 실제로 보이는 것만 쓴다** — 몇 초 차이의 연속 프레임이 육안으로 거의 같아 보이는데도 시간 경과나 상황 변화를 과장해 서술하지 않고, 화면이 정지된 채 표시(코치의 화살표·원 등)만 더해지는 프레임이면 "정지 화면"과 그 표시 내용을 있는 그대로 적는다(라운드6 시각 QA — u008/u004 캡션이 실제로는 같은 정지 장면인데도 서로 다른 시점처럼 서술한 결함).

### "내 피드백" 상태의 이름 강조

"내 피드백"(§6)에서 팀원 X를 선택했을 때, 카드의 "고칠 사람"·"대상(포지션)"·"언급"·"같은 포지션" 줄에서 X의
이름만 `<mark class="mine">X</mark>`(`background: var(--mine-tint); border-radius:
var(--radius-sm); padding: 0 var(--space-1); font-weight: 600; color: inherit;`)로 감싼다.
**본문 자유 텍스트 안의 이름은 강조하지 않는다** — 부분 문자열 오매칭 위험을 피해 구조화된
두 목록에서만 강조한다. 멘션 배지(3번)와는 다른 신호다: 배지는 카드-팀원 관계를, 이 강조는
목록 속 이름 위치를 보여준다.

## 6. 내 피드백 (신규 · 프라이머리 컨트롤)

`.main`의 첫 번째 자식으로, 필터 바(§7)와 시각적으로 분리된 영역이다.

```
<nav class="my-feedback" aria-label="내 피드백">
  <span class="my-feedback-label">내 피드백</span>
  <div class="my-feedback-row" role="list">
    <div role="listitem">
      <button type="button" class="pill pill-mine" data-group="mine" data-value="m003"
              aria-pressed="false">한지우 <span class="count">3</span></button>
    </div>
    ...
  </div>
</nav>
```

`role="listitem"`은 버튼 자신이 아니라 감싸는 `<div>`가 갖는다(§13) — 버튼은 list semantics를
겸하지 않고 오직 pill 인터랙션만 표현한다.

- 표시 대상은 **이 세션에서 관련 결과가 1건 이상인 팀원만**이다(§7의 0건-숨김 규칙과 동일
  원칙). 순서는 명단(roster) 등록 순서를 그대로 쓴다.
- 개수는 세 숫자다. 각 유닛은 팀원별로 **먼저 맞는 한 그룹에만** 센다(`countMineBreakdown`): `member_ids`에 있으면 고칠 점, 아니면 `position_target_ids`에 있으면 내 포지션 대상, 아니면 `addressed_to_all`이고 그 팀원이 그 유닛 경기에 뛰었으면(그 경기 `lineup`에 있거나 그 경기 유닛 원문에 이름이 나옴, `lineup`을 모르는 경기는 전원, `addressedMemberIds`) 전원 대상, 아니면 이름이 나왔거나(`mentionIds`: `member_ids` ∪ `named_member_ids`)·`related_member_ids`에 있으면 참고. 그룹 분류와 `lineup` 범위는 그대로이고 **보이는 방식만** 셋으로 나뉜다: **큰 숫자**(`.count`)는 **고칠 점**(개인 지적)만이고, **팀 표기**(`.count-team`, "· 팀 N")는 **내 포지션 대상 + 전원 대상** 유닛 수(`position_target_ids` — 이름 없이 "수비 라인이 맞지 않음"처럼 내 포지션 전체에 한 말, `position_tags`로 다시 유도하지 않는다; `addressed_to_all` — 모든 팀원에게 적용되는 원칙이라 그 경기에 뛴 팀원(`lineup` ∪ 그 경기 원문에 이름이 나온 팀원)마다 든다. 그 경기에 뛰지 않은 팀원에게는 닿지 않는다)이며, **보조 표기**(`.count-ref`, "· 참고 N")는 나머지 — 위 셋이 아니면서 이름이 나왔거나 (`named_member_ids`), 다른 사람의 개별 지적에 포지션만 겹친(`related_member_ids`) 유닛 수다. 예 "동그리 10 · 팀 10 · 참고 4"는 개인 지적 10장, 포지션·전원 대상 10장, 참고 4장이다. 이전에는 큰 숫자가 고칠 점 + 팀을 합쳐 "동그리 20"이 개인에게 온 카드 20장처럼 읽혔다(고칠 점 10 + 내 포지션 대상 7 + 전원 대상 3). 팀·참고가 0이면 그 표기를 생략한다. pill 버튼에는 `title` 툴팁("숫자: 내가 고칠 점 / 팀: 내 포지션 대상 + 전원 대상 / 참고: 이름이 나온 장면 + 같은 포지션 참고")이 있고, 폰은 hover가 없으므로 같은 뜻의 **보이는 범례 한 줄**(`<p class="my-feedback-legend">`, `.my-feedback-row` 바로 아래, Label 크기·`--muted`: "숫자: 내가 고칠 점 / 팀: 내 포지션 대상 · 전원 대상 / 참고: 이름이 나온 장면 · 같은 포지션 지적")이 pill 줄 아래에 있어, 처음 보는 독자도 "팀"과 "참고"가 무엇을 세는지 알 수 있다 — 카드의 "언급:"·"같은 포지션" 표기와 용어가 달라서다. 큰 숫자가 팀 몫이나 이름이 나온 장면까지 세면, 지적이 2건인 팀원 pill에 "5"가 찍혀 지적이 5건이라고 읽힌다. 큰 숫자 0·팀 또는 참고 N인 팀원도 pill이
  있다(큰 숫자 "0"). pill 노출 조건은 고칠 점 + 팀 + 참고 ≥ 1이며(= 선택하면 카드가 1장 이상 남는 팀원), 셋의 합은 **다른 필터가 걸리지 않은 상태에서** 그 팀원을 고른 결과 수와 같다(pill 숫자 자체는 §7의 패싯 칩과 달리
  라이브 재계산 대상이 아니라 빌드 시점 카운트 그대로다, §7 참고). 필터 바(§7)에는 별도의 "팀원 관련" 그룹을 두지 않는다(중복 제거).
- pill 한 줄은 **1024px 미만에서 가로 스크롤**(`overflow-x: auto; white-space: nowrap;`)이며 줄바꿈하지
  않는다 — 이름이 많아져도 세로로 불어나지 않고, 오른쪽이 살짝 잘려 보이는 것 자체가 "더
  있다"는 신호다(§0 Baymard 근거). 잘림만으로는 390px에서 스크롤 힌트가 약하므로 줄 오른쪽 끝에 알파 마스크 페이드(`mask-image: linear-gradient(to right, #000 calc(100% - var(--space-6)), transparent)`, 색이 아니라 투명도라 라이트·다크 모두 동작)를 걸고, 마지막 pill이 페이드에 가리지 않도록 `padding-right: var(--space-6)`을 둔다. **1024px 이상**은 폭이 넓어 옆으로 밀 이유가 없으므로 `flex-wrap: wrap`으로 줄바꿈한다.
- 활성 상태는 다른 칩과 같은 언어를 쓴다: `aria-pressed="true"`일 때
  `background: var(--accent); color: #fff; border-color: var(--accent);`. 단일 선택이며,
  이미 선택된 pill을 다시 누르면 선택이 풀린다(토글).
- 선택 시: 카드 목록이 그 팀원의 `relatedMembers(unit)` ∪ `named_member_ids`에 해당하는 카드 **더하여
  그 팀원에게 닿는 `addressed_to_all` 카드**(`data-addressed-member-ids`에 그 팀원이 있는 카드)를 남기고, 결과 수가 "피드백 n/m"으로 갱신되며, §5의 이름
  강조와 멘션 배지("고칠 점"/"내 포지션 대상"/"전원 대상"/"이름이 나온 장면"/"같은 포지션 참고", 우선순위는 이 순서, 내 포지션 대상·전원 대상에는 이름이 불렸으면 " · 이름 나옴" 병기, §5-3)가 카드마다 적용돼 고칠 점·내 포지션 대상·전원 대상·이름이 나온 장면·참고용을 구분해 보여준다.
  이것이 필터 그룹들과 **AND**로 결합되는 다섯 번째 조건이다(§7). **30초 기준**(§15 판정 기준 2): 고칠 점 카드가 이름이 나온 장면·포지션
  관련 카드보다 먼저 보여야 팀원이 근거를 빨리 찾는다 — VIEWER_JS는 보이는 카드를 **실제 DOM에서** 재배치해
  `.card-list` 안에 제목(`<h2 class="mine-group-heading">`)과 함께 "고칠 점 N" → "이름이 나온 장면 N" → "내 포지션 대상 N" → "전원 대상 N" → "같은 포지션 참고 N"
  순으로 둔다(N = 그 그룹에서 지금 보이는 카드 수, 비는 그룹은 제목째 생략; 이름이 불린 장면은 고칠 점 바로 다음에 둔다 — 자기 이름이 나온 장면을 먼저 확인한다. 고칠 점·내 포지션 대상·전원 대상이 주 숫자에 드는 "내가 할 것", 이름이 나온 장면과 같은 포지션 참고가 참고다. 그룹 순서는 `MINE_GROUPS`가 정한다). 분류는 `data-member-ids`에 있으면
  고칠 점, 아니면 `data-position-target-ids`에 있으면 내 포지션 대상, 아니면 `data-addressed-member-ids`에 있으면 전원 대상, 아니면 `data-named-ids`에 있으면 이름이 나온 장면(분류 우선순위는 이 순서 그대로이고 표시 순서만 위와 다르다),
  그 외(포지션 관련)는 같은 포지션 참고다. CSS `order`로
  시각 순서만 바꾸면 키보드·스크린리더 순서가 달라지므로 쓰지 않는다. 각 그룹 내부는 원래 시간순을 유지하고, 필터가
  가린 카드는 목록 끝에 숨은 채로 남는다. 선택 해제(또는 "전체 해제"·칩 ×) 시 제목을 지우고 모든 카드를 원래
  시간순 DOM 위치로 되돌린다. 고칠 점 카드의 `.is-direct` 마커는 그대로 토글한다(배지·스타일 훅).
- pill을 고르면(해제는 제외) VIEWER_JS가 그 pill에 `scrollIntoView({ block: "nearest", inline: "nearest" })`를 불러(미지원이면 건너뜀)
  1024px 미만 가로 스크롤 줄에서 가려진 pill(예 4번째)이 보이는 위치로 온다.
- pill의 최소 히트 영역은 44×44px(§13 접근성)다.

이 컨트롤이 필터 바 안이 아니라 별도 섹션인 이유(§1 원칙 1): "내 피드백을 보고 싶다"는
의도는 일반 필터링 의도보다 훨씬 빈번해 항상 먼저 눈에 띄어야 한다 — 필터 바의 기본 닫힘
(§7) 안에 숨기지 않고 언제나 펼쳐 둔다. pill 선택은 §7 활성 필터 요약 줄에도 칩으로 나타난다
(라운드8 시각 QA — 결과 0건이 이 선택과의 조합으로만 나오므로, 원인을 그 줄에서 함께 보여준다).

## 6a. 반복 지적

여러 유닛에 걸쳐 되풀이된 문제를 독자가 한눈에 보도록, `.main`의 `.result-count` 다음·`.card-list` 앞(모든 폭,
1024px 미만 `order: 7`)에 `<section class="recurring">`을 렌더한다. **데이터**: plan.json 최상위 필수 배열
`recurring: [{ label, lines[] }]`(`core.ts` `checkPlan`이 검증, 반복이 없으면 `[]`)가 `plan.validated.json`의
`recurring: [{ label, unit_ids, member_ids }]`(시간 순서)가 되고 세션 `data.json`의 `recurring: [{ label, unit_ids, member_ids, refs_unfound }]`로 이어진다.
`member_ids`는 라벨이 지목한 **반복 행동의 주인**인 로스터 id다(예 "동그리가 더 올라가지 않음" → `["toongri"]`). `[]`는 라벨이 특정 사람이
아니라 팀 단위·포지션을 가리킨다는 뜻이다(예 "수비 라인이 맞지 않음"). `recurring`이 없는 옛 `data.json`은 이름 있는 변환 함수
`recurringFromLegacyData`가 빈 목록으로 바꾸고, `member_ids`가 없는 옛 항목은 `member_ids: []`로 읽는다(주인 없는 항목이므로 아래 k는 "내 포지션 대상"만 센다)(옛 plan.validated.json은 `fc.ts`의 `recurringFromLegacyValidated`). 목록이 비면 블록 자체를 렌더하지 않는다.

- 제목 "반복 지적"(`<h2 class="recurring-title">`, Label 크기). 항목은 반복 유닛 수 내림차순(동수는 plan 순서 유지,
  안정 정렬)이며 각 항목은 `label` · `×N` · [추천 자료 없음] · 유닛 시간 칩들이며, 행(`<li class="recurring-item">`)은 두 목록을 "|"로 이어 싣는다. `data-label-owner-ids`는 항목의 `member_ids`(라벨 주인, 빈 값이면 팀 단위 라벨)이고, `data-owner-ids`는 **칩 단위 소유자**다 — 행의 칩 고칠 사람(`data-fixer-ids`) ∪ 팀 단위 칩(`team_owned` 또는 항목 `member_ids`가 빈 칩)의 유닛 `group_member_ids`(수비 라인·포지션 지적을 받는 사람). 예전에는 `data-owner-ids`가 라벨 주인만 뜻해, 라벨 주인이 비어 있는 "상대 마크를 놓침"이 뎁스차저·우사의 "내 반복"에서 빠졌다. 의미가 바뀌었으므로 옛 의미는 새 이름 `data-label-owner-ids`로 옮겼다(`data-*` id 목록은 전부 "|" 구분 — VIEWER_JS `hasToken`이 "|"로 쪼갠다. 칩의 `data-fixer-ids`가 공백으로 이어져 칩이 둘인 행이 매칭되지 않던 결함 수정). 행에는 주인 이름 목록을 두지 않는다 — 라벨 전체의 주인 목록("상대 마크를 놓침 ×2 · 뎁스차저")을 보면 주인 없는 유닛(제목 "수비진: 상대 역습 때 마크 놓침")까지 그 사람 탓으로 읽혔다. 대신 **시간 칩마다 그 유닛의 주인**을 시간 뒤에 붙인다("9:30 수비진", "12:50 뎁스차저"; `<a ...>9:30 <span class="recurring-unit-owner">수비진</span></a>`).
**칩 주인**(`recurringChipOwner`): 유닛의 고칠 사람(data.json 유닛 `member_ids`)과 항목 `member_ids`의 교집합이 비어 있지 않으면 그 팀원 이름("뎁스차저", 둘이면 "뎁스차저·우사"); 비어 있으면 유닛 제목의 " / " 조각마다 ": " 앞 행위자 중 **로스터 팀원(이름·게이머태그)이 아닌 것**("수비진", "수비 라인", "전원"; "A·B"는 ·로 나눠 따로 본다, 중복 제거 후 ·로 잇는다) — 예 항목 `member_ids: []`, 제목 "수비 라인: 맞지 않음 / 뎁스차저: 첫판부터 정신 놓음"은 "수비 라인"이다(뎁스차저가 아니다). **항목 `member_ids`가 비어 있고(라벨이 팀 단위) 제목에 비-팀원 행위자도 없으면**(예 u009 "뎁스차저: AI 격수 마크를 놓침", 고칠 사람 `[depscharger]`, 라벨 "상대 마크를 놓침" `member_ids: []`) 칩은 **그 유닛의 고칠 사람(`member_ids`) 이름**을 쓴다("12:34 뎁스차저") — 이때 `data-fixer-ids`는 빈 값이라 "내가 고칠 것"에는 세지 않는다(라벨 주인이 아니므로). 항목 `member_ids`가 있는데 교집합이 비면 이 대체는 쓰지 않는다(`check plan`이 그 조합을 주인 누락으로 거부한다). 셋 다 없으면 시간만 보인다. 칩은 `data-fixer-ids`(첫 경우의 팀원 id 목록, "|" 구분, 아니면 빈 값)를 싣고, `aria-label`은 "9:30 수비진 — <유닛 제목>"(주인이 없으면 "9:30 <유닛 제목>")이라 보이는 글자로 시작한다. 시간과 주인 이름 사이는 **`.recurring-unit`의 `gap: var(--space-1)`**이 만든다 — `.chip`이 `display: inline-flex`라 시간 텍스트와 주인 `<span>` 사이의 공백 텍스트 노드가 flex 레이아웃에서 버려져 "1:02:23 4백"이 "1:02:234백"으로 붙어 읽히던 결함(CSS 규칙 자체를 `render.test.ts`가 검사한다 — textContent에는 공백이 남아 있어 그것만으로는 못 잡는다). 칩은 44px 탭 영역을 지키고(`min-height: 44px`) 390px에서 긴 이름이 폭을 넘지 않도록 `white-space: normal; max-width: 100%`와 이름 `overflow-wrap: anywhere`로 줄바꿈한다.
**추천 자료 없음**: 항목의 `refs_unfound: true`(그 label이 refs-draft의 `recurring_unfound`에 있다 — 참고자료를 찾으려 했으나 못 찾음)이면 `<span class="recurring-unfound">추천 자료 없음</span>`(Label 크기·`--muted`·`--line` 아웃라인 알약)을 단다. 이전 문구 "참고자료 못 찾음"은 독자에게 검색 실패로 읽혀 바꿨다. data.json `recurring[].refs_unfound`는 `fc.ts`가 refs-draft의 `recurring_unfound[].label`과 plan label을 비교해 채우는 boolean이고, 필드가 없는 옛 `data.json`은 이름 있는 변환 함수 `refsUnfoundFromLegacyData`가 `false`로 읽는다.
**행 구조(모든 폭)**: 라벨(`.recurring-label`)은 `display: block`으로 자기 줄을 갖고, 그 아래 한 줄(`.recurring-meta`, flex wrap)에 `×N`·"추천 자료 없음"이 놓이며, 시간 칩(`.recurring-units`, flex wrap)은 그 아래 자기 감기는 줄에 놓인다 — 라벨 뒤에 칩이 같은 흐름으로 이어져 들쭉날쭉하게 감기던 문제를 없앤다. `×N` 문구(`.recurring-count`)는 VIEWER_JS가 `.recurring-count-part` 조각(`white-space: nowrap`)으로 다시 쓰며 조각은 앞 공백 없이 "· …"·"(그중 …)" 꼴이고 조각 사이는 일반 공백 텍스트 노드 하나다 — `.recurring-count`가 flex `gap`을 가지므로 공백 글자까지 더하면 간격이 두 배가 된다(flex 컨테이너는 공백 텍스트 노드를 렌더하지 않아 `parts.join(" ")`와 보이는 간격이 flex gap 하나뿐이다).
**팀 단위 칩과 "내 포지션 대상"**: 칩 주인이 팀 단위 행위자("수비 라인", "수비진" — `recurringChipOwner`의 `team_owned`: 고칠 사람 교집합이 없고 제목에 비-팀원 행위자가 있음)이면 칩에 `data-team-owner="true"`를 단다. 이 칩(과 주인 없는 항목의 칩)은 선택한 팀원이 그 유닛의 `data-group-member-ids`에 있으면 — **그 팀원이 유닛의 고칠 사람이어도** — "내 포지션 대상"으로 세고 `.is-mine`을 붙인다(`data-position-target-ids`는 고칠 사람을 빼므로 CB 뎁스차저가 "수비 라인이 맞지 않음" 칩 5개 중 2개만 받던 결함을 막는다). 칩 주인이 그 팀원인 칩(`data-fixer-ids`)은 계속 "내가 고칠 것"이 우선이다.
**내 지적 먼저 + 요약 줄**: "내 피드백"에서 팀원을 고르면 `내가 고칠 것`이 있는 행(그 팀원이 `data-fixer-ids`에 든 칩이 하나라도 있는 행 — 필터와 무관)을 앞으로 올리고 각 묶음 안에서는 원래의 많이 반복된 순서를 지킨다(DOM을 다시 배열하므로 키보드·스크린리더 순서가 보이는 순서와 같다). "더 보기"로 접히는 부분은 선택한 팀원과 무관한 나머지 행 중 보이는 행 순서상 4번째부터다 — 선택한 팀원의 칩(고칠 칩이나 포지션·팀 단위 칩)이 있는 행(`data-owner-ids`에 든 행)은 몇 번째이든 접지 않는다(`수비 라인이 안 맞음 ×4`가 7번째라 접히던 문제). 순서는 고칠 칩 행 → 포지션 칩만 있는 행이고 각 묶음은 반복 많은 순서다. 목록 바로 위 한 줄 `<p class="recurring-summary" hidden>`(Caption 크기·`--muted`)에 "내가 고칠 반복 N · 내 포지션 대상 M"을 보인다 — N은 선택한 팀원이 고칠 칩(`data-fixer-ids`)이 보이는 행 수, M은 고칠 칩은 없고 포지션으로만 닿는 칩(`data-owner-ids`에 있고 `data-fixer-ids`에는 없음)이 보이는 행 수이며, M이 0이면 " · 내 포지션 대상 M"을 생략한다(N이 0이어도 "내가 고칠 반복 0"은 보인다). 행 순서는 내가 고칠 행 → 포지션으로만 닿는 행 → 나머지이고 각 묶음 안은 반복 많은 순서를 지킨다. 선택이 없으면 원래 순서이고 요약 줄은 숨는다.
**≤640px**: 시간 칩 사이 간격을 줄이려 `.recurring-unit`의 margin을 `0 var(--space-1) var(--space-1) 0`(가로 8px→4px)으로 둔다. 데스크톱도 왼쪽 margin은 0이라(`var(--space-1) var(--space-1) var(--space-1) 0`) 첫 칩이 라벨과 같은 왼쪽 선에 선다. 칩은 44px 높이의 탭 영역(§13)이므로 높이는 줄이지 않는다.
- 시간 칩은 `<a class="chip chip-time recurring-unit" href="#<unitId>" data-target="<unitId>">`로, 클릭하면 TOC 항목과
  **같은 동작**(§8: 카드로 스크롤 + `.card--highlighted` 600ms, seek하지 않음)이다.
- 필터·"내 피드백"(§6/§7)이 카드를 숨기면 그 카드를 가리키는 칩도 숨고(숨은 카드로의 앵커는 동작하지 않는다),
  보이는 칩이 없는 항목과 항목이 모두 없는 블록도 숨는다. `×N`은 plan이 정한 총 반복 횟수이고(`data-total`), 필터가 이 항목의 카드를 가려 보이는 칩 수 v가 N보다 작으면 `×N · 보이는 카드 v`로
  바뀐다(칩만 줄고 ×N이 그대로라 독자가 헷갈리던 문제 — 줄임말 "지금"을 떼고 `보이는 카드 v` — 필터를 통과해 화면에 남은 칩이 가리키는 카드 수이며 "이름이 나온 장면"과 무관하다). "내 피드백"(§6)에서 팀원을 고르면 k를 보인다. 두 접미사가 함께 오면 포함 관계를 괄호로 명시한다:
  `×3 · 보이는 카드 2 (그중 내가 고칠 것 1)`; 하나만 해당하면 `×3 · 내가 고칠 것 1` 또는 `×3 · 보이는 카드 2`. "내가 고칠 것"은 **칩 주인이 그 팀원인 칩**(`data-fixer-ids`에 그 팀원)만 센다 — 카드 `member_ids`에 팀원이 있어도 칩 주인이 "수비 라인"처럼 팀 단위 행위자면 세지 않는다. 주인 없는 항목에서 그 팀원에게 `position_target_ids`로만 닿는 유닛(`member_ids`에는 없음)은 따로 "내 포지션 대상 N"으로 센다 — 둘 다 있으면 `×5 · 내가 고칠 것 2 · 내 포지션 대상 3`, 괄호 안도 같은 두 부분(`그중 내가 고칠 것 1 · 내 포지션 대상 1`), 0인 부분은 생략한다(포지션으로만 닿는 유닛을 "내가 고칠 것"이라 부르던 과대 집계를 없앤다). 선택한 팀원이 고칠 카드를 가리키는 칩에는 `.is-mine`을 붙여 `--mine-tint` 배경을 준다(k를 세는 조건과 같다. 뷰어 JS가 선택 변경 때마다 토글). k("내가 고칠 것")는 **선택한 팀원 본인의 반복 행동만** 센다: 항목의 칩 중 칩 주인(`data-fixer-ids`: 유닛 `member_ids` ∩ 항목 `member_ids`)에 그 팀원이 든 칩 수이므로 항목 `member_ids`에 없는 팀원은 센 것이 없고,
  항목의 `member_ids`(반복 행동의 주인)가 **비어 있으면** 팀 단위·포지션 지적이므로 "내 포지션 대상" 카드(`data-position-target-ids`에 그 팀원이고 `member_ids`에는 없음, §6)를 k와 별도로 "내 포지션 대상 N"으로 센다(칩 `.is-mine`은 두 부류 모두에 붙는다). 비어 있지 않으면 선택한 팀원이 주인일 때만, 그것도 `member_ids` 카드만 센다(다른 사람의 반복 실수가 담긴 카드에 팀원이
  함께 지목돼 있어도 세지 않는다). 주인이 여럿인 항목("리턴 패스를 하지 않음"을 세 사람이 각각)은 주인마다 자기 카드만 센다. k는 필터와 무관하고, "같은 포지션 참고"·"이름이 나온 장면"·"전원 대상" 카드(전원 대상은 §6 pill의 팀 숫자에는 들지만 이 k는 본인의 반복 행동만 센다, 그래서 그룹 기준이 pill과 다르다)와 (주인이 있는 항목의) "내 포지션 대상" 카드는 세지 않는다 — 그 카드들은 팀원이 고칠 대상이 아니다. v가 N이거나 k가 0이거나 선택이 없으면 해당 부분을 생략한다. 필터가 칩을 가리지 않으면 k는 항목 전체에서 세고, 가리면 괄호 "그중"의 k는 보이는 칩 안에서만 센다(가려진 내 카드는 "보이는 카드" 안에 없으므로) — 보이는 칩 중 내 카드가 없으면 `×3 · 보이는 카드 2`만 쓴다.
- **모든 폭**에서 보이는 항목 중 위 3개만 보이고(나머지는 `.recurring-extra`; 데스크톱에서 전부 펼쳐 첫 화면에 카드가 하나도 안 보이던 문제), 블록 끝의 `<button class="recurring-more"
  aria-expanded>`("더 보기 (N)" ↔ "접기", 최소 높이 44px, 네이티브 버튼이라 키보드 접근)가 펼친다. 버튼은 마크업에 `hidden`으로
  들어 있고 VIEWER_JS가 숨은 항목이 생길 때만 보이게 한다 — JS가 없으면 전부 보인다.
- 검증(`checkPlan`): `label` 비어 있지 않은 한 줄·40자 이하·plan 안에서 유일, `lines`는 정수 2개 이상이고 각각
  어떤 unit의 `start_line..end_line`에 정확히 속하며 한 항목의 두 줄이 같은 unit에 속하지 않는다. 필드가 없으면
  `"recurring": []`를 추가하라는 에러. `check plan`의 게이트 표(`tableMd`) 끝에 반복 지적이 있으면 "반복 지적:" 목록
  (`- label ×N (unit 시각, …)`)을 덧붙인다.

## 5a. 카드 흐름의 보강 표시

- **경기 구분선**: 카드 흐름에서 앞 카드와 `match_id`가 바뀌는 카드 앞에 `<h2 class="match-divider">`로 그 경기 제목(`match.title`, 이미 "N경기 · 대진"을 담는다)을 둔다. 첫 카드 앞에는 두지 않는다. 그 경기 `marker_legend`(notes `marker_colors`를 경기별로 옮긴 `[{member_id, color}]`)가 비어 있지 않으면 구분선 안에 `<span class="marker-legend">머리 위 표시: 뎁스차저 분홍 삼각형 · 동그리 민트 삼각형</span>`(이름은 명단 표시 이름, `--muted` 13px, 한 줄 아래)을 단다 — 사진 캡션이 "분홍 삼각형"처럼 색으로 사람을 짚을 때 독자가 색의 주인을 알 수 있게 한다. 구분선이 없는 첫 경기는 첫 카드의 제목 아래 `<p class="match-legend">`에 같은 범례를 싣는다. 같은 범례는 그 경기 `unmatched_name_tags`(notes의 같은 이름 필드를 경기별로 옮긴 `[{tag, color?}]`, `member_id`와 섞지 않는 별도 키)도 이름 항목 뒤에 "SAMBA 이름표(명단에 없음) 자홍 삼각형"(색이 없으면 "SAMBA 이름표(명단에 없음)")으로 싣는다 — 사진의 선수 이름표가 명단 누구와도 맞지 않을 때, 독자가 그 사람이 명단 밖이거나 확인되지 않았음을 알고 색으로 찾을 수 있게 한다. 이름 항목과 이름표 항목이 모두 비어 있는 경기에만 범례가 없다. 항목이 없는 경기에는 범례가 없고, `marker_legend`가 없는 옛 data.json은 이름 있는 변환 함수 `markerLegendFromLegacyData`가, `unmatched_name_tags`가 없는 옛 data.json은 `unmatchedNameTagsFromLegacyData`가 `[]`로 읽는다. 구분선은 카드 목록의 일부라 "내 피드백" 재배치(`arrangeCards`)가 카드와 함께 복원하고, 팀원이 선택돼 그룹 제목이 시간 순서를 대신하는 동안과 뒤따르는 보이는 카드가 없을 때는 숨긴다(`updateMatchDividers`). 390px에서도 한 줄 이상으로 감기며 `overflow-wrap: anywhere`다.
- **지적 라벨**: 카드 제목의 -ㅁ(지적) 조각(`isFaultTitleSegment`, `check plan`의 제목 조각 판정과 같은 분류기) **앞에** `<span class="title-fault-label">지적</span>`을 단다. 뒤가 아니라 앞인 이유: 제목이 길어 감기면 뒤 라벨이 다음 줄 끝으로 밀려 어느 조각의 라벨인지 흐려진다.
- **추정 표시**: plan 유닛의 선택 필드 `inferred_member_ids`(⊆ `member_ids`, 원문에 주어가 없어 맥락으로 고칠 사람을 추정한 사람)에 든 팀원의 이름 옆에 `<span class="inferred-mark">(추정 — 문장에 주어 없음)</span>`을 단다. 대상은 본문 아래 "고칠 사람" 줄뿐이다 — "사진에서 위치를 확인하지 못한 사람" 줄은 같은 사람을 다시 부르는 줄이라 표시를 되풀이하지 않고, 제목 글자와 반복 칩에도 달지 않는다. `.inferred-mark`는 `white-space: nowrap`이라 표시가 줄 중간에서 갈라지지 않는다. 필드가 없는 옛 plan.validated.json·data.json은 이름 있는 변환 `inferredMemberIdsFromLegacyValidated`(fc.ts)·`inferredMemberIdsFromLegacyData`(render.ts)가 `[]`로 읽는다.
- **look_at 단독 줄**: `unidentified_member_ids`가 비어도 `look_at`이 있으면(받는 사람이 사진에 안 보이는 경우, `check notes`가 요구한다) 미식별자 줄 없이 `.look-at` 줄만 렌더한다.
- **브레드크럼 토픽**: `.breadcrumb-topic`(`display: inline-block`)이 앞의 `› `(`aria-hidden`, `›`+NBSP)와 토픽 제목 구절을 함께 감싸 한 덩어리로 줄바꿈된다 — `›`는 뒤따르는 조각에 붙어 줄 끝에 홀로 남지 않는다.
- **카드 제목 줄바꿈**: `.card h3`는 `text-wrap: pretty`(전역 제목 `balance`를 덮어씀 — balance는 각 조각을 비슷한 길이로 쪼개 "패스를 | 받으면"처럼 구절 중간을 끊었다)이고 ` / ` 조각(`.title-part`)은 카드 제목 안에서만 `display: block`(한 조각이 새 줄에서 시작; 목차 등 카드 밖은 inline-block 그대로)이다. 제목 묶음에는 결정 규칙을 더했다: 조각 머리 `행위자:`(첫 `:` 앞 20자 이하)는 뒤 첫 낱말과 NBSP로 묶고(`titleHtml`의 `glueActor`, 카드 제목만), 단독 `쪽`은 앞 낱말에(`GLUE_PATTERNS`, "우사 쪽"), 단독 한 음절 부사 `더`는 뒤 낱말에(`ONE_SYLLABLE_DETERMINER`) 붙인다.

## 5b. 피드백 없는 경기

영상에는 있지만 피드백 유닛이 없는 경기는 카드가 없어 페이지가 "1경기 → 3경기"로 건너뛴 것처럼 보인다. plan.json 최상위 **필수** 배열 `matches_without_feedback`(경기 제목 문자열, 항목마다 비어 있지 않고 80자 이하, 없으면 `[]`)이 이를 알린다. `core.ts` `checkPlan`이 검증하고(필드 누락은 `"matches_without_feedback": []`를 추가하라는 에러), `plan.validated.json`의 같은 이름 필드와 세션 `data.json`의 `matches_without_feedback`으로 이어진다. `check plan`의 게이트 표 끝에 있으면 "피드백 없는 경기:" 목록이 붙는다. 필드가 없는 옛 `data.json`은 이름 있는 변환 함수 `matchesWithoutFeedbackFromLegacyData`가, 옛 `plan.validated.json`은 `fc.ts`의 `matchesWithoutFeedbackFromLegacyValidated`가 `[]`로 읽는다.

렌더: 항목마다 `<p class="match-no-feedback">2경기 · LVT 대 AL — 피드백 없음</p>`(Label 크기·`--muted`, 제목은 `titleHtml`)을 렌더한다. 자리는 제목 앞머리의 서수 `N경기`(`matchOrdinal`; 서수는 영상 안 순서이며 빠진 경기도 센다 — SKILL)로 정한다(`placeMatchesWithoutFeedback`): 서수가 더 큰 피드백 있는 경기 중 첫 경기의 구분선 바로 앞(첫 경기 앞이면 첫 카드 앞)에 `.card-list` 안의 줄로 서고, 경기별 목차(`#panel-match`)에도 같은 자리에 `<p class="toc-no-feedback">`로 선다. 서수가 모든 피드백 있는 경기보다 크거나 `N경기`로 시작하지 않아 자리를 모르는 제목은 이전처럼 `.card-list` 바로 뒤 `<div class="matches-without-feedback">`에 한 줄씩 두고(목차는 맨 끝에 같은 줄로), 비면 블록을 렌더하지 않는다. 카드 흐름의 줄은 필터와 무관하게 보이지만 "내 피드백"에서 팀원을 고르면 경기 구분선처럼 숨는다(카드가 관계별로 다시 묶이므로). 1024px 미만 끝 블록은 `order: 11`(빈 상태 뒤).

## 7. 필터 바

필터 그룹은 3개(팀원 관련 그룹은 §6으로 승격되어 여기 없다), 그룹 간 **AND**:

| 그룹 | 선택 방식 | 그룹 내부 결합 |
|---|---|---|
| 포지션 트리 | 단일 선택 | — |
| 주제 | 다중 선택 | **OR** |
| 이름이 나온 선수 | 단일 선택 | — |

### 세션 전체 0건은 숨기고, 선택 조합 0건은 비활성화한다

세 그룹 모두, **이 세션 전체(m건) 기준으로 결과가 1건 이상인 옵션만 빌드 시점에 DOM에 렌더한다** — 세션 전체에 아예 없는 옵션은 지금도 완전히 숨긴다(§1 원칙 4). 각 옵션 라벨 옆에 개수를 괄호로 표시한다(예 "빌드업 (5)").

**렌더된 옵션의 개수는 실시간(live)이다** — 사용자 피드백("누를 게 있는 포지션만 누르게 해달라")을 반영해 고정 개수 계약을 대체한다. 다른 그룹(§6 "내 피드백" 포함)에 선택이 있으면, VIEWER_JS가 각 옵션의 개수를 "자기 그룹 선택만 뺀 나머지 활성 조건을 모두 만족하는 카드 수"로 선택이 바뀔 때마다 다시 계산한다(표준 패싯 검색) — 주제 그룹은 자기 자신의 선택이 자기 옵션 개수에 영향을 주지 않아 내부 OR가 유지된다. 선택이 없으면 이 개수는 빌드 시점 고정 개수와 같다. **재계산한 개수가 0인 옵션은 지우지 않고 `disabled` 속성 + `aria-disabled="true"` + 흐린 스타일로 남긴다**(레이아웃이 튀지 않는다) — 클릭도 되지 않는다. **이미 선택된 옵션은 절대 비활성화하지 않는다**(조합이 0건이 되어도 해제할 수 있어야 한다).

- **포지션 트리**: 어떤 유닛의 `position_tags`에 들어 있는 노드 + 그 조상만 렌더한다 — 노드가 렌더되려면 그 노드 자신이나 **그 자손** 중 하나가 어떤 유닛의 태그여야 한다(예: FW 태그 카드 하나가 ST/WF를 만들지 않고, DF 태그 카드가 CB/FB/WB를 만들지 않으며, FB 태그가 없으면 FB는 빠지고, DF는 CB만 있어도 조상이라 남는다. 트리는 좌우를 가리지 않는다: 뿌리 GK · DF(CB, FB, WB) · MF(CDM, CM, CAM, SM) · FW(WF, ST). 좌우 코드(LB·RB·LWB·RWB·LM·RM·LW·RW·LF·RF·CF)를 쓴 옛 `data.json`은 `renderSession`이 읽을 때 `positionTagsFromLegacyData`/`lineupFromLegacyData`(core의 `positionFromLegacyCode` 한 함수)로 새 코드로 옮긴 뒤 렌더한다). 폐포 개수가 0보다 크다는 것만으로는 렌더 근거가 아니다. 각 노드의 개수는 `posClosure(node) = ∪(anc(t) ∪ desc(t))`(자기 자신+조상+자손 폐포) 카드 수 — DF 선택은 FB 태그 카드를 포함하고 역도 성립하되, CB·FB처럼 공통 조상만 있는 가지는 매칭하지 않는다. 자식이 있는 노드(`.pos-node--branch`)는 2열 행이다 — 자기 칩이 왼쪽 고정 열, 자식들이 오른쪽 열에서 줄바꿈한다(`grid-template-columns: minmax(64px, max-content) minmax(0, 1fr)`). 뿌리(GK/DF/MF/FW) 각각은 `.pos-tree`(세로 flex column)에서 독립된 행이 되어, 1440px에서 모든 뿌리·자식 칩이 한 줄로 흘러 붙는 결함(§15-10)을 막는다. 트리는 뿌리와 그 자식 두 단계뿐이라 가지 안의 가지는 없다. **≤640px**에서는 들여쓰기 *열*이 없다 — `.pos-node--branch`가 `grid-template-columns: minmax(0, 1fr)` 한 열이라 자식 줄은 부모 칩 줄 바로 아래에 놓인다(390px에서 DF 아래 FB/WB 줄이 CB 아래로 밀려 어긋나 보이던 문제). 한 열 그리드에서는 가지 칩(DF/FB/MF)이 전체 폭으로 늘어나 다른 칩과 폭이 달라지므로 `.pos-node--branch > .chip { justify-self: start }`로 내용 폭을 지키고, 트리가 평평하게 읽히지 않도록 `.pos-children`에 `padding-left: var(--space-4)`를 줘 자식 줄을 한 단계 들여쓴다. 자식 노드(leaf)는 `min-width: 0; max-width: 100%;`로 모바일 폭 안에서 줄바꿈한다 — `overflow: hidden`으로 잘라내지 않는다(390px 칩 잘림 결함 방지).
- **주제**: 이 세션에서 1건 이상 쓰인 태그만 옵션으로 렌더하고, 각 옵션에 개수를 표시한다.
- **이름이 나온 선수**: `member_ids` ∪ `named_member_ids`에 1번이라도 등장한 팀원만 옵션으로 렌더하고, 등장 유닛 수를
  개수로 표시하며 매칭도 같은 합집합(`data-mention-ids`)으로 한다.

### 활성 필터 요약

필터 바 바로 아래(결과 수 위)에 활성 필터 칩을 상시 노출한다: §6 "내 피드백" 선택이 있으면
"내 피드백: {이름}" 칩을 맨 앞에 먼저 두고, 그 뒤로 그룹마다 선택된 값을 "라벨: 값" 칩으로
나열한다. 각 칩에 `×`(그 칩 하나만 해제 — 내 피드백 칩의 `×`는 §6 pill 재클릭과 동일하게
동작) + 맨 끝에 "전체 해제" 버튼(`--radius-full` pill, §6의 "내 피드백" 선택도 함께 해제)을
둔다. **내 피드백 선택만 있어도**(다른 그룹 선택 없이) 이 줄은 보인다 — 활성 필터가 전혀
없을 때만 줄 자체를 렌더하지 않는다.

### 결과 수 · 기본 접힘 · 빈 상태

- **결과 수**: "피드백 n/m"(n=현재 표시, m=전체).
- **기본 접힘(모든 폭)**: 필터 바 전체가 `<details><summary>필터 (n)</summary>...</details>`로, `open` 없이 기본 닫힘이다(§6 "내 피드백"은 접히지 않는다). 2차 시각 QA에서 데스크톱 기본값이던 `open`이 1440×900·1024×768 모두 카드 목록을 fold 밖으로 밀어내는 것이 확인돼 모바일·데스크톱 모두 기본 닫힘으로 통일했다(필터는 §1 원칙 4의 보조 도구). `n`은 활성 그룹 수(포지션/주제/이름이 나온 선수, 주제는 태그 개수와 무관하게 1). `<summary>`는 요약도 보여 닫힌 채로도 무엇이 걸려 있는지 알 수 있다(예 "필터 (2) · 포지션 FB, 주제 빌드업").
- **닫힌 줄 모양(모든 폭)**: `summary`는 `justify-content: space-between`인 전체 폭 한 줄(라벨 왼쪽, `▾`/`▴` 오른쪽, `min-height: 44px`, §4의 `.toc-toggle`과 동일)이고, 패딩은 `[open]`일 때만 안쪽 콘텐츠에 준다 — 닫힌 상태가 세로로 길쭉한 상자가 아니라 요약 한 줄로 보이게 한다. 1024px 미만은 `.layout`의 `align-items: stretch`(§4)로 이 줄도 전체 폭이다.
- **빈 상태는 AND 조합이 0건일 때만 나온다.** 패싯 칩(포지션·주제·이름이 나온 선수)은 선택 조합이 0건이 되는 순간 이미 비활성화되므로, 패싯 칩만으로는 빈 상태에 도달할 수 없다(위 라이브 카운트 규칙) — 실제로 도달하는 경로는 필터를 먼저 고르고 그다음 §6 "내 피드백" 대상을 골라 그 조합이 우연히 0건이 되는 경우뿐이다(pill은 비활성화 대상이 아니라 빌드 시점 카운트 그대로다). 0건이면 카드 목록과 목차 항목이 모두 사라지고 §11의 빈 상태를 보인다.

## 8. 목차 탭

`<div role="tablist">` 안에 탭 2개, `<button role="tab" aria-selected="true|false"
aria-controls="...">`로 구현한다:

- **경기별**: 경기 → 주제 → 피드백 3단 트리. 각 주제 노드는 `topics[].summary` 요약을 함께
  보인다. 한 주제가 시간상 떨어진 유닛을 묶을 수 있으므로(`contracts.md` plan 순서 규칙) 주제는 **가장 이른 유닛의 시간 순서**로, 주제 안 유닛은 시간 순서로 늘어놓는다(plan에 적힌 주제 순서가 아니다). 카드 목록은 주제와 무관하게 `data.json`의 `units`(= 유닛 id 순 = 시간 순) 그대로이고, 각 카드의 브레드크럼이 경기 › 주제를 말한다.
- **주제별**: 경기 무관, 주제 태그 → 피드백 목록. 태그 옆에 개수를 괄호로 표시(`빌드업 (5)`). 숫자는 `<span class="toc-group-count">`이고, 필터·"내 피드백"이 항목을 숨기면 `hideEmptyTocGroups`가 그 그룹에서 지금 보이는 `.toc-item` 수로 바꾼다(해제하면 원래 수). 경기별 그룹 제목에는 개수가 없다. 그룹은 **유닛 수
  내림차순**이며 같으면 처음 등장한 순서를 유지한다(안정 정렬). 필터 바의 주제 칩 순서(§7)는 처음 등장 순서 그대로다.

1024px 이상에서 tablist는 `.toc-scroll` 안에서 `position: sticky; top: 0`(배경 `--bg`)으로 맨 위에 고정돼, 목차를 스크롤해도
"경기별/주제별" 전환이 밀려나지 않는다(1024px 미만은 `.toc-scroll`이 스크롤하지 않으므로 적용하지 않는다). 같은 1024px 이상에서 `.toc-scroll`은 아래 28px에 페이드 마스크(`mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent)`, `-webkit-` 접두 포함)를 두어 아래에 잘린 줄이 "더 있다"로 읽히게 하고, 같은 높이의 `padding-bottom: 28px`이 끝까지 스크롤했을 때 마지막 줄이 페이드에 가려지지 않게 한다.

스캔하기 쉽도록: 경기 제목(H2)과 주제 그룹 헤더 사이 간격을 `--space-6`으로 벌리고, 각 유닛
항목은 시간 칩 + 제목만 한 줄로 짧게 보인다(카드 전체 내용을 목차에 복제하지 않는다).

**현재 카드 표시**: VIEWER_JS `updateCurrentToc`가 뷰포트 위쪽을 차지한 카드의 TOC 항목(모든 패널의 같은 `data-target` 사본)에 `.is-current`와 `aria-current="true"`를 두고 나머지에서는 뗀다. 현재 카드 = 보이는(`hidden` 아닌) 카드 중 위쪽 모서리가 뷰포트 높이의 30%(`CURRENT_CARD_VIEWPORT_SHARE`) 이내인 마지막 카드이고, 모든 카드가 그보다 아래에서 시작하면 첫 보이는 카드다. 시작할 때, 필터를 적용할 때(`applyFilters`), 문서 `scroll`(requestAnimationFrame으로 묶음)과 `resize`마다 돈다. `.toc-item.is-current`의 색·밑줄 스타일은 전에도 있었으나 아무 코드도 클래스를 주지 않았다.

TOC 항목 클릭은 **seek하지 않는다** — 대상 카드로 스크롤(`scrollIntoView`,
`scroll-margin-top` 적용) 후 `.card--highlighted`(`--accent` 보더 2px, 600ms 후 제거)와
그 TOC 항목의 `.is-current`를 함께 준다(600ms 뒤 `.card--highlighted`만 제거하고 `.is-current`는 아래 스크롤 위치 판정으로 다시 정한다). 필터·"내 피드백"으로 숨겨진
카드에 해당하는 TOC 항목은 함께 숨긴다(데스크톱 측면 목차와 모바일 목차는 같은 목록이다). 항목의 숨김 여부는 자기 속성이 아니라
`data-target`이 가리키는 카드의 `hidden`에서 그대로 읽는다 — 카드와 목차의 판정이 어긋날 수 없다.
`.toc-item`은 `grid-template-columns: auto minmax(0, 1fr)` 그리드(시간 칩 | `.toc-title`)이고, 시간 칩(`.toc-item .chip-time`)은 `min-width: 8ch`·`tabular-nums`로 "9:30"·"11:30"·"1:01:48"(h:mm:ss)의 폭이 같아 제목 시작선이 흔들리지 않으며, 줄바꿈된 라벨이 칩 아래가 아니라 칩 뒤 열에 정렬된다 — 항목을 숨긴 결과 그 경기/주제 그룹에 보이는 항목이
0개가 되면, 그룹 헤더(`.toc-match-group`/`.toc-topic-group`/`.toc-tag-group`)도 함께
숨긴다. `:has()`에 기대지 않고 매 `applyFilters` 호출마다 각 그룹을 순회해
`querySelector(".toc-item:not([hidden])")` 유무로 `hidden` 속성을 직접 토글한다(구형
엔진 호환). 목차 링크는 평소 `color: var(--muted); text-decoration: none;`이고
hover/focus/`.is-current`에서만 `--accent`+밑줄을 받는다 — 필터 칩과 달리 안 읽은 링크처럼
차분하게 둔다.

## 9. 영상 전환

- 파트 전환 버튼: `<button aria-pressed="true|false">Part 2</button>`, 활성 파트만
  `aria-pressed="true"`.
- 카드/본문 프레임 클릭 시:
  - **같은 파트**(재생 중인 videoId와 대상 videoId가 같음): `player.seekTo(t, true);
    player.playVideo();`
  - **다른 파트**: `player.loadVideoById({ videoId, startSeconds: t });`(전환+seek 한 번에).
- **onReady 이전 대기**: `onReady` 전에 클릭이 들어오면 `{videoId, start}` 하나를 단일 슬롯에 저장한다 — 큐가 아니라 매 클릭이 이전 값을 통째로 대체하므로, 다른 파트를 잇따라 pre-ready 클릭해도 `onReady`에는 마지막 클릭의 목표만 적용된다(먼저 클릭한 파트의 stale seek가 나중 파트에 잘못 흘러드는 것을 막는다, REAL BUG 회귀 테스트로 고정).
- **콜드 로드 안전한 초기화**: `VIEWER_JS` 초기화는 `window.YT !== undefined && window.YT.loaded`
  일 때만 즉시 플레이어를 생성한다. `window.YT`를 선언 없이 bare identifier로 읽으면 아직
  `iframe_api` 스크립트가 로드되지 않은 시점에 `ReferenceError`가 나 `else` 분기의
  `window.onYouTubeIframeAPIReady` 등록 자체가 실행되지 않는 사고로 이어진다 — 반드시
  `typeof`/전역 존재 확인을 거친 뒤 읽는다. 같은 이유로 "생성 시도함" 플래그(`playerCreated`)는
  `new window.YT.Player(...)`가 실제로 실행된 뒤에만 true로 바꾼다 — 미리 true로 두면
  `window.YT`가 아직 없어 생성이 실패했을 때도 재시도 자체가 막혀, 나중에 API가 로드돼도
  플레이어가 영원히 안 만들어지는 결함으로 이어진다(REAL BUG, 회귀 테스트로 고정).
- **스크립트 로드 순서**: `VIEWER_JS`를 `iframe_api` 스크립트보다 **먼저** 로드한다.
- **테스트 훅**: `document.body.dataset.video`(현재 재생 중인 videoId)와 `window.fcPlayer`
  (YT.Player 인스턴스)를 항상 최신 상태로 유지한다.
- **접힌 미니 바 시각 갱신**(§4 플레이어 접기): 접힌 동안만 1초 간격으로 현재 재생 시각을
  다시 읽어 미니 바 텍스트를 갱신한다. 펼치면 그 interval을 즉시 clear한다 — 펼쳐진 동안은
  실제 플레이어가 보이므로 별도 텍스트 갱신이 필요 없다.
- **링크 전용 세션**: 모든 영상이 `embeddable: false`면 플레이어·플레이스홀더·파트 전환 버튼을 렌더하지 않고
  §4의 `.watch-bar`만 둔다. 카드 헤더·본문 프레임의 시간 칩은 `https://youtu.be/<video>?t=<floor(초)>`를
  새 탭으로 여는 진짜 링크(§5)이고 카드 클릭은 seek를 시도하지 않는다. 아래 플레이스홀더 규칙은 **혼합 세션**
  (일부 파트만 임베드 불가)에만 적용된다.
- **임베드 불가 플레이스홀더**: 영상별로 판정한다. `embeddable: false`면 iframe 대신
  플레이스홀더(썸네일 또는 텍스트 카드 + "유튜브에서 시청 ↗")를 보인다. 카드에서 전환한
  경우 새 탭 링크는 그 카드의 시작 시각을 가리킨다. 각 카드의 "경기 영상 m:ss부터 보기 ↗"(§5)는
  플레이어 상태와 무관하게 항상 유지한다.

## 10. 한글 타이포

폰트 스택은 시스템 폰트만 쓴다(웹폰트 없음):

```
font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
```

| 속성 | 값 | 목적 |
|---|---|---|
| `word-break` | `keep-all` | 한글 어절 단위 줄바꿈 |
| `overflow-wrap` | `anywhere` | 긴 영문 URL/닉네임도 가로 스크롤 없이 줄바꿈 |
| `line-break` | `strict` | 구두점이 줄 시작에 오지 않게 |
| `text-wrap` | 제목 `balance`(카드 제목 `.card h3`만 `pretty`), 본문(`p, dd, li, figcaption`, §12 번역 표 `td`) `pretty` | 제목은 균형, 본문은 마지막 줄 orphan 방지 — 카드 제목은 구절 중간이 균등 분할로 끊기지 않게 pretty |

최소 크기·행간은 §2 타입 스케일을 따른다(본문 16px 이상, 행간 1.6–1.7). `word-break: keep-all`/`text-wrap: pretty`는 단어 경계에서만 줄을 바꾸므로 부정(-지 못/않)·금지형(-지 말고/말아/말라/말자)·짧은 부정 "안/못"+뒤따르는 용언("안 된다며"·"못 했다" — 단독 어절일 때만이라 "안쪽"·"못지않게" 같은 단어 일부에는 걸리지 않는다)·의존명사(수/것과 그 축약형 게/거/걸/건/겁)·관형사형+"때"("가졌을 때"·"받을 때"·"있는 때" — "때리-/때려-/때렸-"은 동사라 제외)·"-기 전/시작"·"-다 보니"·"서 있"("떨어져 서 있고" — 단독 어절 "서"일 때만이라 "에서 있"·"서로"는 걸리지 않는다)·숫자(아라비아 숫자 또는 한/두/세... 고유어 수사)+단위, 날짜 "N월 N일"("10월 2일" — 세션 H1·아카이브 카드 제목에서 월과 일이 갈라지지 않는다) 같은 **묶인 문법 구성**의 중간 줄바꿈까지는 막지 못한다 — `render.ts`의 `glueKorean()`이 그 구성 안의 공백을 U+00A0로 바꿔 렌더 단계에서 막는다(§15-1). 구성 경계에 `**` 볼드 마커가 붙어도(마커가 공백 앞에서 닫히든 공백 뒤에서 열리든) 같은 공백이 nbsp로 치환된다. 받침 판정(-ㄹ/-ㄴ 관형사형, 예 "앞당겨질 것", "할 수 있다")은 융합 음절의 유니코드 코드포인트에서 종성 인덱스를 직접 계산해 감지한다 — 실제 문장에 나타나지 않는 낱자모 ㄹ/ㄴ 문자를 정규식에 직접 넣는 방식은 오탐이 아니라 미탐(never-matches) 버그였다. 여러 묶인 구성이 공백 하나 간격으로 연쇄되면(예 "찾기 시작하다 보니") 한 구간이 통째로 줄바꿈 불가능해질 수 있어, nbsp로 이어붙인 한 구간이 14자(390px 컬럼에서 Body 크기 기준)를 넘으면 그 안의 이음매 하나를 도로 공백으로 되돌려 끊는다(§15-1). `titleHtml()`은 여기에 제목류 규칙을 더한다. (0) 연속된 대문자 라틴 단어 **2~3개**(고유명사 "Los Veteranos")는 U+00A0로 묶는다. 4개 이상 이어진 줄("How To Win Every Header In FC 25")은 통째로 묶으면 390px 컬럼보다 넓은 줄바꿈 불가 덩어리가 돼 `overflow-wrap: anywhere`가 단어 중간("I / n")을 자르므로 묶지 않고 공백에서 줄바꿈되게 둔다(`MAX_LATIN_GLUE_WORDS`). 단 게임 버전 표기 "FC 26"·"FIFA 23"(계열 + 숫자)은 U+00A0로 묶어 "FC / 26"으로 갈라지지 않게 하고, 괄호 안쪽 공백은 일반 공백으로 둔다(과거에는 20자 이하 괄호 묶음의 공백을 U+00A0로 묶었으나, 캡션 "뎁스차저(DEPSCHARGER 이름표)가"가 ~230px 불가분 덩어리가 돼 390px 캡션 컬럼 폭 ~195px을 넘고 `overflow-wrap: anywhere`가 덩어리 끝에서 잘라 조사 "가"가 줄 머리로 고아가 된 결함 — 시각 리뷰). 괄호를 조사에 붙이는 것은 `glueKorean`의 ")" 뒤 U+2060뿐이다. 또한 " ·" 구분점은 앞 단어에 붙이고 공백 없이 붙은 "·"는 앞에 U+2060 WORD JOINER를 넣어 줄이 "·"로 시작하지 않는다(`glueTitle`, `glueKorean` 뒤에 적용해 14자 상한이 되돌리지 않는다). (1) `" / "`로 이어진 제목은 `<span class="title-part">`(inline-block, `text-decoration: inherit`로 부모 링크의 밑줄이 조각 안에도 이어진다 — 아카이브 목록; inline-block은 조상의 밑줄을 전파받지 못하므로 부모 `.toc-item .toc-title`도 `text-decoration: inherit`를 써서 `<a>`의 밑줄이 `.toc-title` → `.title-part`로 이어진다. 이게 없으면 제목에 " / "가 든 링크만 밑줄이 없었다) 조각으로 나뉘고 슬래시는 앞 조각 끝에 붙는다 — 줄은 조각 사이에서만 바뀌고 슬래시로 시작하지 않는다. (2) 마지막 어절이 2음절 이하 한글(놓침·넓힘·빔·"명을")이면 앞 어절에 U+00A0로 붙고, 앞 어절이 1음절("상대 한 명을"의 "한")이면 한 어절 더 이어 붙는다(`MAX_GLUE_RUN` 상한은 그대로). 묶인 구성 목록에는 "양 + 명사"(양 팀)도 든다. `glueKorean()`은 제목·본문·캡션 공통으로 (a) 한글 바로 뒤의 "("(예 "이스코(ISCO 이름표)") 앞과 (b) ")" 바로 뒤에 붙은 조사(이/가/은/는/을/를/의/에/에서/로/으로/와/과/도/만/까지/부터/처럼/보다, 조사 뒤에 한글이 더 이어지면 제외) 앞에 U+2060 WORD JOINER를 넣어 "용딘(YONGDIN 이름표) / 이 골대"·"이스코 / (ISCO 이름표)"처럼 괄호나 조사가 고아가 되는 줄바꿈을 막고, (c) 숫자 범위 `숫자–숫자`·`숫자-숫자`("6–8m")의 구분 기호 앞뒤에도 U+2060을 넣어 "6– / 8m"으로 쪼개지지 않게 한다. 독립된 두 단어 사이의 통상적인 어절 줄바꿈(예 "수비 전환", "출발 신호")은 결함이 아니다 — 차단 판정은 묶인 문법 구성 한정이다. `visual-qa`의 CJK 검사(조사/어미 고아 줄, 제목류의 주어-술어 분리, 연결어 중간 분리, 짧은 인용/출처 영문 줄바꿈, 제목 한 글자 고아 줄)는 전수 검사이며 표본 추출을 허용하지 않는다(§13) — 본문 문단·캡션의 통상적인 어절 줄바꿈과 §12 번역 표 원문 전체 문장의 줄바꿈은 검사 대상에서 제외한다(라운드6 CJK 검토: 둘 다 구조적으로 막을 수 없거나 막을 필요가 없는 일반 줄바꿈이다).

**제목류 추가 글루(리뷰 2차)**: `glueTitle`이 390px 줄바꿈 결함 세 가지를 더 막는다. (1) 한 음절 지시어 "한/이/그/각"과 다음 낱말 사이 공백은 U+00A0다 — 앞이 한글이 아닌 낱말 시작일 때만이라 "공간이 넓게"의 "이"처럼 낱말 끝 글자에는 걸리지 않는다. (2) 제목의 " & "는 앞뒤 낱말 모두에 붙는다(참고자료 제목 "Tips & Tricks"가 "&"만 줄 끝에 남던 문제) — 괄호 안의 "&"는 위의 "괄호 안 공백은 끊을 수 있게 둔다" 규칙이 이겨 그대로 둔다. (3) "슈퍼 캔슬"은 게임 용어 한 덩어리로 붙인다. (4) 제목 조각 끝의 괄호 헤지 "(필요해 보임)"(뒤에 " /"가 올 수 있다)는 앞 낱말과 U+00A0로 묶는다 — 헤지만 다음 줄에 혼자 남지 않게 한다. 조각 끝 괄호가 12자 이하이면 앞 낱말과의 사이에 공백이 없어도("내주기(찬스가 있었을 듯)") 괄호 안쪽 공백도 U+00A0로 바꿔 괄호 안에서 줄이 바뀌지 않게 한다(`SHORT_TRAILING_PAREN`, g23 u028 "내주기(찬스가 ⏎ 있었을 듯)"); 괄호 앞은 `glueKorean`의 U+2060이 이미 막는다. 13자 이상 괄호는 안쪽을 일반 공백으로 둬 390px 컬럼보다 넓은 불가분 덩어리를 만들지 않는다. `glueKorean`은 한글 사이 가운뎃점 뒤에 U+2060을 둔다("윙·풀백"이 점에서 갈라지지 않는다). 본문 문단(`renderBodyText`)에는 적용하지 않는다.

전수 검사인 만큼 예외 사이트를 남기지 않는다: 세션/아카이브/참고자료 페이지가 렌더하는 모든 한글 표시 텍스트(제목·헤더·TOC 라벨·브레드크럼·참고자료 요약/핵심 포인트/번역 표 한국어 셀 포함, §12 원문 셀 제외)는 `render.ts`의 `titleHtml()` 하나(glue→escape→nobr)를 거친다 — 사이트별로 따로 `escapeHtml()`만 부르는 우회 경로를 만들지 않는다(라운드7 리뷰: 여러 곳이 이 경로를 놓치고 있었다).

## 11. 빈 상태

| 상황 | 표시 |
|---|---|
| 필터 AND 조합 결과 0건 | "조건에 맞는 피드백이 없어요" + 리셋 버튼. 카드 목록·목차 항목 모두 숨김(§7) |
| 빈 아카이브(발행된 세션 없음) | 아카이브 첫 페이지에 "아직 발행된 세션이 없어요." 텍스트만, 세션 카드 그리드 없음. **이 상태도 세션 페이지와 같은 셸/토큰/푸터 고지를 쓰는 `renderIndex` 출력이어야 한다** — 별도의 하드코딩된 플레이스홀더 HTML 경로를 두지 않는다 |
| 본문에 프레임 없는 유닛 | 대표 시작 이미지(§5-3)는 항상 렌더하되, 본문은 text 블록만으로 구성된다 — 빈 figure나 플레이스홀더 박스를 만들지 않는다 |
| disabled 모드(팀원 명단 없음) | "내 피드백"(§6)과 "이름이 나온 선수" 필터를 화면과 키보드 조작 모두에서 렌더하지 않는다(존재하지 않는 명단으로 이름을 지어내지 않는다). 카드의 "고칠 사람"·"언급"·"같은 포지션" 줄도 렌더하지 않는다. 유사 과거 피드백 섹션은 명단 유무와 관계없이 생략한다. 포지션·주제 필터와 본문·이미지는 명단과 무관하게 정상 제공한다 |

disabled 모드에서 명단이 없으면 alias 정규화를 생략하고, similar는 빈 결과로 건너뛰며,
`render --site-only`로 로컬 사이트만 만들어 아카이브의 `index.json`은 갱신하지 않는다.

**빈 상태의 시각적 처리**: 필터 빈 상태와 빈 아카이브는 같은 `.empty-state` 클래스를
공유하며, `--surface`+`--line`+`--radius-md` 틴트 패널로 감싸고 안내 문구·리셋 버튼을 세로
`--space-4` 간격으로 가운데 정렬한다(리셋 없는 빈 아카이브는 문구만).

## 12. 아카이브 첫 페이지 / 참고자료 페이지

아카이브 첫 페이지와 참고자료 페이지는 JS 없이 완전히 동작한다(정적 HTML, 뷰어 스크립트
2개는 세션 페이지 전용). 세 페이지 모두 `<meta name="robots" content="noindex, nofollow">`를
포함한다(프로젝트 Pages의 `robots.txt`로 대체하지 않는다).

### 아카이브 첫 페이지

- 세션 카드를 최신순(날짜 desc)으로 나열: 날짜("영상 업로드 YYYY-MM-DD" — 세션 헤더와 같은 라벨), 제목, 파트 수, 피드백 개수, 주제 칩 목록.
  타입 스케일·색·간격 토큰은 세션 뷰어와 동일하다(§2). 카드 전체가 클릭 타깃이지만
  `color: var(--ink); text-decoration: none;`로 카드 전체에 밑줄을 걸지 않는다 — 날짜는
  `--muted`로 작게, 제목만 hover/focus 시 `--accent` 색+밑줄을 받는다(밑줄이 클릭 타깃
  경계가 아니라 제목 하나를 가리키게 한다).
- "주제별 전체 피드백" 링크 — 아카이브 전체를 가로지르는 주제별 뷰로 이동. 그 뷰(`#by-topic`)의 항목(`.toc-item`)은 링크로 읽혀야 한다 —
  `--accent` 글자색+밑줄(hover/focus는 `--accent-hover`), 항목 사이 `--line` 헤어라인(마지막 항목 제외), 고정 세로 패딩 `--space-3`(줄바꿈된 긴 제목도 항목 간 리듬이 같도록 리스트 `gap`은 0). 세션 뷰어의 목차(`.toc-item`, `--muted`)는 그대로다.
- 빈 상태는 §11 참고(같은 렌더러 출력이어야 한다).
- 푸터 고지: "팀 내부 피드백용 비공식 정리 문서입니다. 영상 저작권은 원게시자에게
  있습니다."(원문 그대로 — "원 게시자"로 띄어 쓰면 390px에서 "원"이 고아 줄로 남는다, §10) —
  세션 페이지 푸터와 동일 문구.

### 참고자료(refs) 페이지

- 제목, 형식 배지(`.ref-format`, "영상"/"글") + `kind` 배지(카드와 같은 `refKindLabel` 매핑의 한국어 표기, enum 값 그대로 노출 금지) + 프로클럽 배지(`pro_clubs`일 때만) + 버전 배지(`version_badge`가 null이 아닐 때만) + 언어 배지 — 카드와 같은 `renderRefBadges` 한 곳이 만든다, 원문 링크(카드와 같은 `refOpenLink`, 새 탭). 이 페이지는 그 자료를 인용한 모든 유닛에 하나뿐이고 카드마다 시작 시각이 다를 수 있으므로(1:31 / 1:09 / 1:33), 인용한 유닛의 `video_starts`가 **모두 같은 시각일 때만** "m:ss부터 보기 ↗"로 그 시각부터 열고(`refPageStartSeconds`), 시각이 서로 다르거나 일부 유닛에 시각이 없으면 시각 없는 "원문 ↗"로 영상 처음을 연다 — 가장 이른 시각을 대표로 고르지 않는다. 배지는 제목 아래 자기 줄에 놓는다.
- 한국어 요약(`summary_ko`), 핵심 포인트 목록(`key_points_ko`) — Body 크기(1.0625rem/1.7,
  §2)로 세션 카드 본문과 같은 가독성을 준다(요약이라고 작게 줄이지 않는다). 요약 단락은 `max-width: var(--measure)`로
  읽기 폭을 제한한다(`.ref-main`은 960px 컬럼이라 제한이 없으면 한 줄이 너무 길어진다).
- 원문 | 한국어 2열 표(`translations[]`, 최대 5행). 헤더 셀은 Caption(0.875rem/700),
  본문 셀은 Body(1.0625rem/1.7). `border: 0; border-bottom: 1px solid var(--line);
  padding: var(--space-3);`로 셀 경계를 구분선 하나로 단순화한다. **1024px 미만**에서는
  영문 원문 전체 문장이 좁은 열 안에서 단어 중간에 끊기므로, `thead`를 숨기고 각 `td`를
  `data-label`(원문/한국어) 라벨이 붙은 전체 폭 블록으로 세로 스택한다(`display: block`) —
  데스크톱 2열 표는 그대로 유지한다(라운드6 CJK 검토).
- "아카이브로 돌아가기" 링크.
- `ko` 언어 참고자료는 이 페이지 자체가 생성되지 않는다(§5 참고자료 규칙과 동일 이유).

## 13. 접근성

- **포커스**: 모든 인터랙티브 요소(칩, pill, 버튼, 탭, 링크, details/summary)는 키보드 포커스
  시 `outline: 2px solid var(--focus); outline-offset: 2px;`를 보인다. `outline: none`으로
  지우고 대체 인디케이터 없이 두지 않는다.
- **대비**: 본문/보조 텍스트는 배경 대비 4.5:1 이상, 포지션 칩 텍스트도 그 칩 배경 대비 4.5:1
  이상. 인터랙티브 요소의 비텍스트 대비(칩·pill·버튼 보더, 아이콘)는 3:1 이상 —
  `--line`(1.25:1)이 아니라 `--line-strong`(3.45:1, §2)을 쓴다. 장식용 구분선(카드/이미지/
  figure 테두리)만 `--line`을 쓴다.
- **탭 타깃**: 버튼, 탭, 칩, pill, part 전환 버튼, "플레이어 접기" 버튼, `.toc-toggle`,
  `.seek-btn`, 참고자료 링크(`.ref-link`), 자료 교훈 줄의 출처 링크(`.ref-lesson-source`, 같은 `::after` 기법), "확대"(`.zoom-link`), 카드 하단 영상 링크(`.watch-link`)(모두 `::after` 44px 히트 영역 — `.ref-link`는 `min-width` 없이 내용 폭이고 `::after`가 링크 가운데 기준으로 확장한다(§5 항목 10)), 반복 지적 시간 칩(`.recurring-unit`, `min-height: 44px`), details summary의 클릭 가능 영역은 최소 44×44px(작은 시간 칩처럼 시각 크기를
  키울 수 없으면 `::after`로 중앙 정렬된 확장 히트 영역을 쓴다).
- 목차 탭은 `role="tablist"`/`role="tab"`/`aria-selected`를 정확히 따른다. 파트 전환 버튼과
  필터/`내 피드백` pill은 `aria-pressed`를, "플레이어 접기" 버튼과 `.toc-toggle`은
  `aria-expanded`를 쓴다 — 스크린리더에 선택·펼침 상태를 전달하는 유일한 수단이므로 시각
  스타일만으로 대체하지 않는다.
- **리스트 semantics는 인터랙션 요소와 분리한다**: "내 피드백" pill의 `role="listitem"`은
  버튼 자신이 아니라 감싸는 `<div>`가 갖는다(§6) — 버튼이 list semantics까지 겸하면
  스크린리더가 같은 요소를 버튼과 목록 항목 두 가지로 동시에 안내해야 한다.
- **텍스트 선택과 seek**: `window.getSelection().toString()`이 비어 있지 않은 동안의 카드
  클릭은 seek를 실행하지 않는다(§5, 드래그 선택 방해 방지).

## 14. 캡처 세트 (visual-QA)

기본 캡처 세트는 1024×768 기본 상태를 포함한 **37장 고정**이다. 첫 회차와 승인(APPROVE)
회차에는 37장 전체를 새로 촬영한다. 중간 회차에는 수정 영향을 받은 것만 재촬영할 수 있지만,
전체 판정 대상의 열거는 항상 아래 37개다. 뷰어 상태 캡처는 파트가 2개인 현재 세션 fixture를
쓴다(`disabled-mode`/`embed-blocked`는 각자 필요한 별도 fixture, 아래 참고).

`disabled-mode`(§11)·`embed-blocked`(§9)는 v2 신규로 34·35번에 추가했다.

| # | id | page | state | viewport |
|---|---|---|---|---|
| 1 | `default-390` | session | 필터 없음, 기본 진입 화면 | 390×844 |
| 2 | `default-1440` | session | 필터 없음, 기본 진입 화면 | 1440×900 |
| 3 | `toc-topic-390` | session | 목차 "주제별" 탭 활성 | 390×844 |
| 4 | `toc-topic-1440` | session | 목차 "주제별" 탭 활성 | 1440×900 |
| 5 | `filter-position-390` | session | 포지션 필터 `FB` 선택 | 390×844 |
| 6 | `filter-position-1440` | session | 포지션 필터 `FB` 선택 | 1440×900 |
| 7 | `filter-topic-multi-390` | session | 주제 필터 "수비전환"+"역습" 다중 선택(OR) | 390×844 |
| 8 | `filter-topic-multi-1440` | session | 주제 필터 "수비전환"+"역습" 다중 선택(OR) | 1440×900 |
| 9 | `filter-mention-390` | session | 이름이 나온 선수 필터 선택 | 390×844 |
| 10 | `filter-mention-1440` | session | 이름이 나온 선수 필터 선택 | 1440×900 |
| 11 | `my-feedback-390` | session | "내 피드백"에서 팀원 1명 선택(§6) | 390×844 |
| 12 | `my-feedback-1440` | session | "내 피드백"에서 팀원 1명 선택(§6) | 1440×900 |
| 13 | `filter-empty-and-390` | session | 필터 옵션 + "내 피드백" 조합 결과 0건(§7: 패싯끼리는 0건에 도달 불가) | 390×844 |
| 14 | `filter-empty-and-1440` | session | 필터 옵션 + "내 피드백" 조합 결과 0건(§7: 패싯끼리는 0건에 도달 불가) | 1440×900 |
| 15 | `seek-part1-390` | session | Part 1 카드 클릭 직후(seek 반영) | 390×844 |
| 16 | `seek-part1-1440` | session | Part 1 카드 클릭 직후(seek 반영) | 1440×900 |
| 17 | `switch-part2-390` | session | Part 2 카드 클릭 직후(영상 전환+seek 반영) | 390×844 |
| 18 | `switch-part2-1440` | session | Part 2 카드 클릭 직후(영상 전환+seek 반영) | 1440×900 |
| 19 | `scroll-mid-390` | session | 카드 목록을 마지막 카드 부근까지 스크롤(모바일에서 sticky 플레이어가 카드 전 구간에서 고정을 유지하는지 확인, §4) | 390×844 |
| 20 | `scroll-mid-1440` | session | 카드 목록 중간까지 스크롤(sticky 플레이어 위치 확인) | 1440×900 |
| 21 | `body-frames-closeup-390` | session | 본문 프레임 ≥2개인 카드까지 스크롤한 클로즈업 | 390×844 |
| 22 | `body-frames-closeup-1440` | session | 본문 프레임 ≥2개인 카드까지 스크롤한 클로즈업 | 1440×900 |
| 23 | `full-page-390` | session | 전체 페이지(풀 스크린샷, 스크롤 길이 전체) | 390×844 |
| 24 | `full-page-1440` | session | 전체 페이지(풀 스크린샷, 스크롤 길이 전체) | 1440×900 |
| 25 | `past-session-390` | session | 과거 단일 세션(파트 1개) 기본 화면 | 390×844 |
| 26 | `past-session-1440` | session | 과거 단일 세션(파트 1개) 기본 화면 | 1440×900 |
| 27 | `archive-with-sessions-390` | archive | 아카이브 첫 페이지, 세션 있음 | 390×844 |
| 28 | `archive-with-sessions-1440` | archive | 아카이브 첫 페이지, 세션 있음 | 1440×900 |
| 29 | `archive-empty-390` | archive | 아카이브 첫 페이지, 빈 상태 | 390×844 |
| 30 | `archive-empty-1440` | archive | 아카이브 첫 페이지, 빈 상태 | 1440×900 |
| 31 | `ref-en-390` | ref | 참고자료 페이지(영문 원문) | 390×844 |
| 32 | `ref-en-1440` | ref | 참고자료 페이지(영문 원문) | 1440×900 |
| 33 | `default-1024x768` | session | 레이아웃 전환 경계값 기본 상태 | 1024×768 |
| 34 | `disabled-mode-390` | session | 팀원 명단 없이 렌더(§11 disabled 모드): "내 피드백"·이름이 나온 선수 필터·카드의 "고칠 사람"/"언급"/"같은 포지션" 줄·@멘션 칩이 모두 미노출 | 390×844 |
| 35 | `embed-blocked-390` | session | `embeddable: false`인 파트의 임베드 불가 플레이스홀더(썸네일 또는 텍스트 카드 + "유튜브에서 시청 ↗", §9) | 390×844 |
| 36 | `my-feedback-related-390` | session | 내 피드백 윤도훈 선택 후 첫 '같은 포지션 참고' 카드까지 스크롤 — 참고 배지 대비 확인 | 390×844 |
| 37 | `my-feedback-related-1440` | session | 내 피드백 윤도훈 선택 후 첫 '같은 포지션 참고' 카드까지 스크롤 — 참고 배지 대비 확인 | 1440×900 |

### 기능 검사 (`functional.json`)

각 항목은 `{"name", "kind": "dom" | "player_api", "pass": bool, "skipped_reason": string |
null}` 형태로 기록한다. `kind: "dom"` 항목은 `skipped_reason`을 허용하지 않는다 — 전부
`pass: true`여야 한다. `kind: "player_api"` 항목은 헤드리스 재생 제약으로 스킵을 허용하되
(`skipped_reason`에 사유), 승인 회차의 headed 재시도(`capture.sh --headed`)에서는 스킵을
허용하지 않는다.

`dom` 항목(v1에서 이어받는 것 + v2 신규):

- 카드 클릭 후 `document.body.dataset.video`가 해당 카드의 videoId와 일치, 다른 파트 카드
  클릭 후 해당 파트 버튼만 `aria-pressed="true"`.
- 목차 클릭 후 대상 카드로 스크롤·강조(`.card--highlighted`+TOC `.is-current`)되며 seek는
  발생하지 않음. 필터로 숨겨져 보이는 항목이 0개인 TOC 그룹은 그룹 헤더도 함께 숨음.
- 필터 리셋 후 결과 수가 전체 m으로 복귀, 탭 `aria-selected` 전환. **결과 0건인 옵션은
  DOM에 렌더되지 않는다**(예: GK 태그가 없으면 포지션 트리에 GK 노드 자체가 없음). **필터
  옵션 고정**: AND 조합이 0건이 되어도 선택된 옵션이 사라지지 않는다.
- **본문 프레임 클릭은 `data-frame-t` 값으로 seek한다**(카드의 시작 시각이 아니라 그
  프레임의 시각). 헤더 줄·프레임의 `.seek-btn` 클릭도 같은 seek를 실행한다.
- **"내 피드백"에서 팀원 1명 선택 시** 그 팀원의 `relatedMembers` 카드만 남고 결과 수가
  정확히 갱신되며, `.card-list.mine-active`에서 `.is-direct`(고칠 점) 카드가 먼저 온다.
  **멘션 배지**는 `data-member-ids`면 "고칠 점", `data-position-target-ids`면 "내 포지션 대상", `data-addressed-to-all="true"`면 "전원 대상"(둘 다 `data-named-ids`에도 있으면 " · 이름 나옴" 병기), `data-named-ids`면 "이름이 나온 장면", `data-related-ids`만이면
  "같은 포지션 참고"를 보인다.
- **텍스트 선택 중 seek 무시**: 드래그 선택 중인 카드를 클릭해도 재생 상태가 바뀌지 않는다.
- **내 피드백 그룹 재배치**: 팀원 선택 시 `.card-list`의 DOM 순서가 "고칠 점 N → 이름이 나온 장면 N → 내 포지션 대상 N → 전원 대상 N → 같은 포지션 참고 N"
  제목(비는 그룹 생략) 아래 카드 순이고, 해제하면 제목이 사라지고 원래 시간순으로 돌아온다. "내 포지션 대상"은 data.json `position_target_ids`로 정한다(`position_tags`에서 유도하지 않는다). pill의 주 숫자(고칠 점 + 내 포지션 대상 + 전원 대상) + 참고
  숫자(이름이 나온 장면 + 같은 포지션 참고) = 선택 직후 결과 수.
- **링크 전용 세션**(모든 파트 `embeddable: false`): `.player-wrapper`가 없고 `.watch-bar`에 파트별 링크가 있으며,
  카드 헤더·프레임 시간 칩이 `href`가 맞는 `<a>`이고 카드 클릭이 `body[data-video]`를 바꾸지 않는다.
- **시작 이미지 생략**: 본문 프레임이 하나라도 있는 카드(`t`가 `unit.start`와 같든 다르든)에는 `.card-image`가 없고 `.chip-row`는 남는다. 본문 프레임이 없는 카드만 시작 이미지를 가진다.
- **모바일 sticky 유지**: 390px에서 카드 목록 끝까지 스크롤해도 `.player-wrapper` 고정이
  유지된다(펼침 시 상단, 접힘 시 44px).

`player_api` 항목: `window.fcPlayer.getCurrentTime()`이 클릭한 카드/프레임의 시작 시각과
±2초 이내로 일치, `window.fcPlayer.getVideoData().video_id`가 전환 후 목표 파트의 videoId와
일치.

## 15. 판정 기준

`visual-qa`의 오라클 각각이 `VERDICT: PASS`이고 `BLOCKING`이 비어 있어야 승인(APPROVE)이다.
v2는 기존 Pass A/B(계약 준수)에 더해 **매 회차마다 아래 네 관점을 전부 병렬로 실행**하고
넷 다 PASS여야 승인한다:

1. Pass A/B(계약·접근성·CJK·캡처 세트 — 기존 오라클, 아래 항목으로 판정).
2. **팀원 독자 리뷰**: "내 피드백"에서 실제 팀원 이름 하나를 골라, **30초 안에 선택한 팀원
   기준으로 "다음 경기에서 시도할 행동 1개"와 그 근거 장면(카드) 1개를 말로 지목할 수 있으면
   통과**로 판정한다. 30초 안에 행동 1개+근거 카드 1개를 둘 다 지목하지 못하면 REVISE.
3. **미감 리뷰**: 아래 아름다움/가독성 항목을 계약 위반 여부와 별개로 판정한다.
   `similarityScore`나 전반적 인상이 좋아도 "구리다"는 인상이 남으면 REVISE.

아래는 차단(blocking) 결함 목록이다 — 하나라도 있으면 REVISE/FAIL이다:

1. **CJK 줄바꿈 위반**(§10): 조사/어미 고아 줄, 제목류(H1/H2/H3·카드 제목·TOC 라벨·아카이브 카드 제목)의 주어-술어 분리, 묶인 문법 구성(부정 -지 못/않, 금지 -지 말고, 의존명사 수/것/게/거/걸/건/겁, -기 전/시작/위해/때문, -다 보니/보면, 숫자+단위 등)의 중간 분리, 짧은 인용/출처 영문 문자열(따옴표 인용, 제목) 줄바꿈, 제목 한 글자/음절 고아 줄, 글리프 깨짐(tofu) — 페이지 전수 검사. 독립된 두 단어 사이의 통상적인 어절 줄바꿈(예 "수비 전환")과 본문 문단·캡션 안의 어절 단위 주어-술어 줄바꿈(예 "상대 수비가 / 좁혀지는")은 결함이 아니다 — 일반적인 한글 어절 줄바꿈이라 구조적으로 막을 수 없다. §12 번역 표 원문 전체 문장의 줄바꿈도 결함이 아니다(<1024px 스택 레이아웃에서 전체 폭으로 줄바꿈된다).
2. **토큰 이탈**: §2에 없는 raw hex, 임의 px 간격/반경, §2 타입 스케일에 없는 폰트 크기.
3. **레이아웃 계약 위반**(§4): 1024px 이상에서 `.player-wrapper`/`.part-switch`에
   `flex-shrink: 0`이 빠져 플레이어가 보이지 않거나 찌그러짐, `.main`이 단일 wrapper가
   아니라 개별 요소로 흩어짐, 1024px 미만에서 펼친 sticky 플레이어 전체 높이(영상+툴바)가
   244px을 넘어 본문을 밀어냄, 카드가 sticky 플레이어에 가려짐(`scroll-margin-top` 누락/오계산),
   카드 스크롤 중 sticky 고정이 풀림(`.side-col`의 `display: contents` 누락 등), "플레이어
   접기" 버튼의 `aria-expanded` 불일치.
4. **카드 필드 누락/순서 오류**(§5): 태그 행→고칠 사람/언급→본문→같은 포지션 순서가 아님, 시간
   칩이 m:ss/h:mm:ss 분기를 따르지 않음, ko 참고자료에 "요약" 링크가 잘못 노출(또는 비-ko에
   없음), 대표 이미지에 width/height가 없어 레이아웃 시프트, 본문 프레임에 캡션·"확대" 링크가
   없거나 새 탭/`rel="noopener"` 없이 열림, 멘션 배지가 미선택 상태에 나타나거나 종류가
   `data-member-ids`/`data-position-target-ids`/`data-named-ids`/`data-related-ids` 판정과 다름(고칠 점 ↔ 내 포지션 대상 ↔ 같은 포지션 참고 뒤바뀜).
5. **필터/목차 계약 위반**(§7,§8): 그룹 간 AND가 OR처럼 동작, 주제 그룹 내부가 OR가 아님,
   목차 클릭이 seek를 발생시킴, 세션 전체 0건 옵션이 렌더됨(빌드 시점 가지치기 누락), AND
   조합이 아닌데 빈 상태가 나옴, 선택된 옵션이 다른 그룹 선택으로 DOM에서 사라지거나
   비활성화됨, 선택 조합이 0건인데 옵션이 비활성화되지 않고 계속 클릭됨(§7 라이브 카운트).
6. **영상 전환 계약 위반**(§9): 같은 파트에서 `loadVideoById` 호출, 다른 파트에서 `seekTo`만
   호출, `onReady` 이전 클릭 무시, `YT`를 bare identifier로 읽어 콜드 로드 `ReferenceError`,
   API 스크립트가 `VIEWER_JS`보다 먼저 로드됨, 텍스트 선택 중 seek가 실행됨, "확대" 링크
   클릭이 seek와 함께 발생함(§5).
7. **기능 검사 실패**(§14): 필수 검사 항목 누락, `kind: "dom"` 항목 중 `pass`가 true가
   아니거나 `skipped_reason`이 null이 아닌 항목이 있음. 일반 헤드리스 회차의 `player_api`
   실패는 `skipped_reason`이 있을 때만 스킵 허용. headed 실행/승인 회차는 스킵 없이 전부
   `pass: true`.
8. **캡처 세트 불완전/신선도 위반**(§14): `capture-manifest.json` 길이가 37이 아니거나,
   §14에 열거한 조합이 누락·중복되거나, PNG가 아닌 파일이 섞이거나, 검증 대상 소스보다
   오래된 캡처를 씀.
9. **접근성 회귀**: 포커스 링이 안 보임, 탭 타깃이 44px 미만, `role="tablist"`/
   `aria-selected`/`aria-pressed`/`aria-expanded` 중 하나라도 빠짐, 인터랙티브 요소 경계에
   `--line-strong`이 아니라 `--line`(1.25:1, 3:1 미달)을 씀.
10. **미감·가독성 위반**(신규): 본문 문단이 16px 미만, `--measure`가 720px을 넘음, 본문
    행간이 1.6 미만, 이미지/figure가 읽기 컬럼 전체 폭이 아님, 인터랙티브 요소에 액센트가
    아닌 두 번째 색이 경쟁적으로 쓰임(포지션 칩 제외), 모바일에서 태그 행이 2줄을 넘게
    줄바꿈됨, 플레이어가 안 보이거나 찌그러짐(링크 전용 세션은 플레이어 대신 `.watch-bar`가 정상이다), 접힌 플레이어의 플레이스홀더가 "펼치기" 버튼을 덮음, 초광각(비 > 2) 프레임이 ≤640px에서 페이지를 가로로 스크롤시키거나 이동 상자 없이 높이 ~100px로 납작하게 보임, 콘텐츠로 설명 안 되는 160px 넘는 빈 공백이
    있음, 팀원이 자기 피드백을 찾는 데 "내 피드백" pill 1회 탭을 넘는 조작이 필요함, 헤더에
    제목+날짜 외의 요소(칩·버튼·아이콘 등)가 섞여 산만함.

차단이 아닌 항목: 서브픽셀 렌더링 차이, 폰트 힌팅에 따른 안티앨리어싱 차이, 브라우저별
스크롤바 폭 차이로 인한 1–2px 디프.

## 16. 검사·검색 규칙 (스크립트가 정하는 것)

원칙(§1)대로 스크립트는 **데이터에서 결정되는 것만** 자동화하고 글쓴이의 판단을 제한하지 않는다. 아래 규칙은 모두 "확인했다는 흔적이 글에 있는가"를 보며, 무엇을 써야 하는지는 정하지 않는다. 계약 문구와 에러 메시지는 `references/contracts.md`가 정본이다.

- **마커 색은 찾아본다**(`check notes`, `checkMarkerColorsLooked`): 유닛이 팀원 M을 `unidentified_member_ids`에 넣었고 `marker_colors`에 그 유닛 경기·M의 색 C가 있으면, 그 유닛 frame 캡션 하나는 C와 "삼각형"을 함께 담아 색으로 M을 짚거나, 유닛의 `marker_unresolved_ko[M]`(1–80자 한 줄, 카드에 렌더하지 않는 작업 기록)에 짚지 못한 이유를 적는다. 색을 적어 두고 그 유닛 프레임에서는 찾지 않은 채 "못 찾음"으로 넘기는 것을 막는다. 이유를 캡션에 쓰면 독자가 작업 메모를 읽게 되므로 캡션의 작업 메모 꼴(`/색으로\s*(사람을\s*)?가리키지\s*않/`, `/삼각형이\s*(함께|같이)\s*(있어|보여)/`)은 에러다(`requireNoMarkerWorkNote`). `marker_unresolved_ko`의 키는 그 유닛의 `unidentified_member_ids` 안의 팀원이어야 한다.
- **명단에 없는 이름표는 기록한다**(`check notes`, `checkUnmatchedNameTags`): frame 캡션의 "<TAG> 이름표"가 명단 팀원에 속하지 않으면(TAG가 이름·별칭·게이머태그를 담거나, TAG가 든 괄호 바로 앞이 팀원 이름이면 속한다 — 명단 대조는 기존 `mentionsMember`/`memberLabels`) 그 유닛 경기의 `unmatched_name_tags`에 있어야 한다. 이름표가 누구인지 추정하지 않고 "명단에 없음"으로 카드 범례에 남긴다("SAMBA"가 아마 우사라도 사용자만 확정한다). 같은 쉼표 절에서 앞의 "상대"가 가리키는 상대 선수 이름표는 대상이 아니다. 거꾸로 `unmatched_name_tags`의 `tag`가 명단에 속하면 에러다.
- **색 삼각형은 범례에 있는 색이다**(`check notes`, `checkColourMentionsInLegend`): 캡션·`fault_scene`·`look_at`·`direction_check_ko`의 "<색> 삼각형"은 그 경기 `marker_colors`/`unmatched_name_tags`의 색이어야 한다(상대 선수 이야기는 같은 쉼표 절에서 색 앞의 "상대"로 면제). 범례에 없는 색은 독자가 찾을 사람이 없는 포인터이므로 기록하거나 위치로만 쓴다. 에러는 유닛·색마다 한 번이다. "상대"가 색 뒤에 오는 절("자홍 삼각형 수비수(SAMBA 이름표)와 … 상대 하나와 붙어")은 면제하지 않는다.
- **패스 카드는 공을 말한다**(`check notes`, `checkPassCardNamesBall`): 제목 조각에 "패스" 또는 "<팀원>에게"가 있으면 frame 캡션 하나 이상에 낱말 "공"(조사 꼴 포함, 공격·공간·공중 제외)이 있다. 패스는 공의 위치 없이 읽히지 않는다.
- **방향 확인 카드는 장면 줄이 없다**(`check notes`, `checkFaultScene`): `direction_check_ko`가 있으면 `fault_scene`은 에러이고 -ㅁ 제목의 `fault_scene` 필수는 면제다. 원문 방향과 프레임이 어긋난 카드는 원문이 말한 장면을 프레임으로 보여 줄 수 없다.
- **추정 행위자가 반복 지적에 묶이면 알린다**(`check plan`, `recurringInferredActorWarnings`): `recurring[].member_ids`에 든 팀원이 연결 유닛의 `inferred_member_ids`에도 있으면 "반복 지적 <label>: <이름>는 <유닛>에서 추정한 행위자다" 경고(비차단)를 낸다. 아무도 이름 붙이지 않은 사람에게 반복 잘못을 지우는 것을 글쓴이가 한 번 더 보게 한다.
- **반복 지적 후보 경고의 잡음 거르기**(`check plan`, `recurringCandidateWarnings`): 공통어에서 명단 팀원의 이름·별칭·게이머태그, 조건절 낱말(-면·-때 꼴), "패스하기"를 뺀다. 한 줄에 공통어를 정렬해 모두 나열한다.
- **자막 적중은 줄바꿈을 건너 찾는다**(`refs-bundle`·`check refs`, `cueHitText`): `subtitle_terms`는 자막 줄을 단일 공백으로 이은 글(뒤따르는 줄 3개까지)에서 찾고, 시작한 줄의 시각으로 보고하며 걸친 줄 전체를 싣는다("receives the" / "ball"로 갈라진 "receives the ball"도 찾는다). `check refs`는 `recurring_unfound`·`units_unfound`의 용어가 이미 붙은 영상 자료의 자막에 있으면 "보유 자료 재확인: <용어> — <영상 id> <m:ss>" 경고(비차단)를 두 단어 이상 용어만, 용어·영상마다 가장 이른 적중으로 낸다.
- **recurring_unfound는 실제 축구 검색을 시도한다**(`check refs`): 모든 검색어가 게임 용어(fc·fifa·eafc·ea fc·pro clubs·피파·프로클럽)를 담으면 에러다. `units_unfound`에는 적용하지 않는다.
- **유닛 제목 핵심어는 용어를 넓히고 조사성 낱말을 뺀다**(`refs-bundle`, `titleKeywords`): 핵심어는 ": " 뒤 행동의 한글 낱말 앞 2음절(2음절 낱말은 통째, 영문 3자 이상은 소문자)에서 만든다. `TITLE_KEYWORD_STOPS`가 어미(않기·하기·않는·않고)에 더해 조사성 낱말(말고·혼자·대신·보다·계속·너무·바로·하지)을 뺀다 — g23 u014 "혼자 오프사이드 트랩 걸지 말고 뒤로 빼기"의 "혼자"·"말고"가 주제가 아닌 자막에 걸리던 것을 막는다. `GAME_TERM_SYNONYMS`(오프사이드·옵사·offside, 슈퍼 캔슬·슈캔·super cancel, 크로스·cross, 헤딩·header, 프리킥·free kick, 코너킥·corner kick)의 한 표기가 제목 행동에 있으면 그 묶음의 다른 표기를 통째로(2음절 어간이 아니라) 핵심어에 더한다 — 코치 강의는 "옵사라인"이라 말하는데 제목의 "오프사이드"는 어간 "오프"가 되어 못 찾던 결함. 동의어는 핵심어를 더하기만 하고 기존 어간 핵심어는 빼지 않는다(표에 없는 낱말의 동작은 그대로). 나머지 규칙(코퍼스 1% 상한, 희귀 핵심어 가중, 유닛당 10줄)은 그대로다.
- **같은 채널 후보 검색**(`refs-bundle`, `channelCandidateLines`): 채널은 붙은 자료가 덮는 유닛 수 순(같으면 프로클럽 자료가 있는 채널 먼저). 한 채널의 검색은 시리즈 표시를 뗀 자료 제목(같은 채널의 다른 편), 그다음 unfound 기록의 키워드(명단 이름·조건절 낱말·조사를 뗌; 영어 채널은 라틴 `subtitle_terms` 우선) 순이다. 상한 12개는 채널을 돌아가며 나눠 쓴다. 검색은 채널 안에서 한다: 채널마다 첫 붙은 자료의 영상에서 `--print channel_url`로 채널 URL을 한 번 받아 `<채널 URL>/search?query=<키워드>`를 `--flat-playlist --playlist-end 10`으로 훑는다(`ytChannelUrlArgs`·`ytChannelSearchArgs`). 채널 URL을 못 받거나 채널 안 검색이 실패하면 "채널 안 검색 불가 — 전체 검색으로 대신함"을 적고 `ytsearch10:<채널> <키워드> <축구 단어>`로 대신한다(한국어 채널은 "축구", 아니면 "football" — 전체 검색이 다른 분야 영상을 돌려주는 것을 막는다). 테스트용 `FC_FEEDBACK_YTDLP_BIN`과 `--no-search`는 그대로다.
