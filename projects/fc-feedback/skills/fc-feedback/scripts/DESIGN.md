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
| 플레이어 컨트롤 배경 | `--player-control-bg` | `rgba(255,255,255,0.9)` | 1024px 미만에서 영상 위에 얹히는 "플레이어 접기" 버튼의 반투명 배경 전용(영상 어디에 겹쳐도 텍스트 대비를 확보하려고 반투명 흰색을 쓴다) |
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
`--radius-full`. `.chip`의 칩-칩 간 외부 margin도 `--space-1`을 재사용한다(flex `gap` 없이 인라인 흐름으로 줄바꿈되는 주제/언급 선수 칩 목록의 최소 간격).

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
<header class="header">...세션 제목, 날짜...</header>
<div class="layout">
  <div class="side-col">
    <div class="player-wrapper">
      ...플레이어...
      <button type="button" class="player-collapse" aria-expanded="true"
              aria-controls="player-media">플레이어 접기</button>
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
                     aspect-ratio: auto; height: min(56.25vw, 200px); }
  .player-wrapper.is-collapsed { height: 44px; }
  /* order 2~9: part-switch, my-feedback, filter-bar, active-filters,
     result-count, card-list, empty-state, toc-scroll(마지막, 접힘) */
  .toc-scroll { overflow-y: visible; } /* .toc-panel이 hidden으로 접히므로 자체 스크롤 불필요 */
}
```

`align-items: stretch`(기본값 `flex-start` 대체): 필터 바·목차 토글의 닫힌 줄, 활성 필터
줄, 빈 상태 패널이 모두 `.layout`의 flex 아이템이므로, `stretch`가 없으면 내용 폭만큼만
좁게 그려져 필터/목차 토글이 작은 알약 모양이 된다(390px 결함). `--content-max`가 없는
1024px 미만에서는 `.header`/`.footer`의 좌우 패딩을 `--space-4`로 직접 줘 본문 폭과
맞춘다(위 §4 마크업 골격 참고).

**왜 세 wrapper를 모두 `display: contents`로 지우는가**: v1은 플레이어를 짧은 `.side`에 가둬 sticky containing block이 카드 구간에서 끊겼다. v2는 `.side-col`·`.side`·`.main`을 전부 지워 모든 섹션을 `.layout`(전체 스크롤 길이) 하나의 flex 아이템으로 만들어 containing block을 넓히는 동시에, 마크업 순서와 무관하게 위 `order`만으로 재배치할 수 있게 한다 — 2차 시각 QA가 지적한 "목차가 '내 피드백'보다 먼저 나와 약 1950px 아래로 밀린다" 결함이 이걸로 없어진다. 목차를 맨 뒤(order 9)에 둔 것은 §1 원칙 4(내비게이션은 그다음)를 따른 것이다.

플레이어는 200px을 넘지 않아 세로로 긴 화면에서 뷰포트 절반을 차지하는 사고를 막는다. 필터 바(§7)는 모든 폭에서 기본 닫힘, 목차(§8)는 1024px 미만에서만 `.toc-panel[hidden]`으로 기본 닫힘이다. header/footer는 `.layout` 밖 실제 형제라 v1식 순서 강제가 필요 없다.

### 플레이어 접기(1024px 미만 전용)

`.player-wrapper` 안의 "플레이어 접기" 버튼(`aria-expanded`)을 누르면 플레이어가 44px 높이의
미니 바로 접힌다:

- 접힌 상태: `.player-wrapper.is-collapsed`(`height: 44px`), 라벨은 "펼치기"로 바뀌고
  `aria-expanded="false"`. 미니 바에는 "▶ 현재 파트 + 현재 재생 시각"만 보인다(예 "▶ Part 2 · 3:12").
- iframe(유튜브 플레이어)은 접힌 상태에서도 DOM에서 유지한 채 높이만 44px로 줄인다(재생 유지) —
  뗐다 붙이면 `iframe` 재로드로 재생 위치를 잃는다.
- **접힘 상태는 in-page 상태다**(`localStorage`/쿠키 등 영속 저장소를 쓰지 않는다) — 새로고침
  하거나 새로 열면 항상 펼쳐진 기본 상태(`aria-expanded="true"`)로 시작한다.
- 버튼·미니 바 탭 영역은 44×44px 이상(§13)이며, 마크업(§4 골격)엔 항상 존재하되 1024px
  이상에서는 `.player-collapse { display: none; }`로 CSS만 숨긴다 — 데스크톱은 이 기능으로
  바뀌지 않는다.

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

카드 루트는 `<article class="card" data-video data-start data-pos data-topics data-member-ids data-related-ids>`. `data-member-ids`는 `member_ids`를, `data-related-ids`는 `relatedMembers(unit)`(직접 언급 ∪ 포지션 관련, `data-member-ids`의 상위집합)을 `|`로 구분한 id 목록으로 담는다 — `data-pos`/`data-topics`도 같은 구분자다. 주제 태그는 공백을 포함할 수 있어(`core.ts`의 `isValidTag`) 공백 구분자는 단독 선택 시 매칭이 깨지므로, 태그에 쓸 수 없는 `|`를 쓴다. 멘션 배지(아래 3번)는 이 목록에서 id 존재만 확인하면 된다. `a`/`button`/`summary`/`figure` 태그가 아닌 카드 영역 클릭은 그 카드의 시작 시각으로 `seek`한다(카드 전체가 클릭 타깃, §13 탭 타깃 44px 규칙). 헤더 줄(1번)의 시간 칩은 `<button class="seek-btn">`(예 "0:30부터 재생")이라 키보드로도 같은 seek를 실행할 수 있다 — 카드 자체는 포커스 불가 요소라 탭 스톱을 늘리지 않으면서 키보드 접근을 보장한다(§13). 단 `window.getSelection().toString()`이 비어 있지 않으면(사용자가 카드 안 텍스트를 드래그 선택 중이면) 그 클릭에서는 `seek`를 실행하지 않는다 — 문장을 드래그해 복사하려는 조작을 방해하지 않기 위함이다(§13).

카드 내부 순서:

1. **헤더 줄**: 시간 칩(▶ 아이콘 + `m:ss`/`h:mm:ss`, 3600초 기준 분기) + 파트 칩(다중 파트
   세션에서만) + 브레드크럼(`경기 › 주제`, `›`는 `aria-hidden`). 전부 Label 크기(13px)로
   작게 유지해 시각적 무게가 제목·본문(2·7번)에 쏠리게 한다.
2. **제목**: `<h3>` 유닛 제목.
3. **멘션 배지**: "내 피드백"(§6)에서 팀원을 선택했을 때만 제목 바로 아래 배지 1개를
   보인다 — `data-member-ids`에 있으면 "직접 언급"(`background: var(--accent); color:
   var(--bg);` 채움), 없지만 `data-related-ids`에는 있으면 "포지션 관련(참고)"(`background:
   var(--bg); color: var(--muted); border: 1px solid var(--line);` 아웃라인) — 채움 vs
   아웃라인으로 자기 잘못과 참고용을 한눈에 구분한다. 미선택 상태에서는 렌더하지 않는다.
4. **대표 시작 이미지**: `<img>`에 실제 프레임의 width/height로 레이아웃 시프트를 막는다.
   클릭 시 시작 시각으로 seek(카드 공통 클릭 규칙). 폭은 `.card` 전체 폭(§2 `--measure`).
   figcaption은 태그 행(5번)과 한 줄 공유 — 태그 왼쪽, "확대"(새 탭 원본 링크) 오른쪽
   (`justify-content: space-between`), 태그가 다음 줄로 밀리는 2줄 배치는 금지(§15-10).
5. **태그 행**: 포지션 칩(`position_tags`, 루트 그룹 GK/DF/MF/FW 색) + 주제 칩(중립,
   `--surface-sunken` 배경)을 원래 순서대로 이어 붙여 **최대 6개만 보이고**, 나머지는 `+N`
   칩(중립색, 클릭 불가, 순수 카운트 표시) 하나로 묶는다. `@멘션` 칩은 이 행에 넣지 않는다
   (다음 항목으로 분리). 4번 이미지의 figcaption 안에 렌더되지만 필드 순서는 그대로다.
6. **언급된 팀원**: `member_ids`에 있는 팀원을 이름으로 나열("언급: 한지우, 윤도훈"). 비어
   있으면 이 줄 자체를 렌더하지 않는다(disabled 모드에서도 항상 생략, §10).
7. **본문**: `unit.body`(blocks 배열)를 작성 순서 그대로 렌더한다. 노트 dl(문제/누구/대신)은
   v2에서 완전히 폐기한다.
   - `{type:"text", text}` → `<p>`. `text`를 escape한 뒤 `**굵게**`만 `<strong>`으로 바꾼다.
     그 외 마크다운(이탤릭, 링크, 목록 등)은 변환하지 않고 문자 그대로 남긴다. 개행은
     블록 경계로만 쓰고 블록 내부 `\n`은 없다(블록 하나 = 문단 하나).
   - `{type:"frame", src, width, height, t, caption}` → `<figure class="body-frame"
     data-frame-t="{t}"><img src width height loading="lazy"><figcaption>{시간 칩,
     `.seek-btn` 버튼}<span class="body-frame-caption">{caption}</span><a href="{src}"
     target="_blank" rel="noopener" class="zoom-link" aria-label="이미지 원본 크게
     보기">확대</a></figcaption></figure>`. 폭은 `.card`/`.main` 전체 폭(§2 `--measure`).
     figcaption은 `auto minmax(0,1fr) auto` 3열 그리드 — 시간 칩·"확대"는 고정 폭, 캡션만
     가운데 열에서 줄바꿈되며 상단 정렬 유지(`align-items: start`) — 캡션 길이에 따라 셋이
     1~4줄로 흩어지던 결함(§15-10)을 막는다. `figure` 클릭은 `data-frame-t`로 seek한다(카드
     시작 시각이 아니라 **그 프레임의 시각**). "확대" 클릭은 버블링돼도
     `event.target.closest('a')`로 확인해 seek를 무시한다. 캡션은 필수(빌드 실패 검증)이며
     시각을 다시 쓰지 않는다(시각 칩이 이미 표시).
8. **관련 팀원**: `relatedMembers(unit) \ member_ids`(집합 차, 이미 "언급된 팀원"에 나온
   사람은 다시 보여주지 않는다)를 이름으로 나열("관련: 이름, 이름"). 결과가 비면 이 섹션
   자체를 렌더하지 않는다.
9. **유사한 과거 피드백**: 있을 때만, 세션 날짜 + 링크(해당 세션의 유닛 앵커).
10. **참고자료**: 제목, 언어 배지(`lang`), 링크. `lang !== "ko"`면 "요약"(→
    `refs/<id>.html`) + "원문 ↗"(외부, `target="_blank" rel="noopener"`). `lang === "ko"`면
    "원문 ↗"만("요약" 링크 자체를 렌더하지 않는다).
11. **"유튜브에서 보기 ↗"**: `https://youtu.be/<videoId>?t=<startSeconds>`, 새 탭. 플레이어
    임베드 가능 여부와 무관하게 항상 렌더한다(JS 없이도 동작해야 하는 요구사항).

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

"내 피드백"(§6)에서 팀원 X를 선택했을 때, 카드의 "언급된 팀원"·"관련 팀원" 두 줄에서 X의
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
- 개수는 `relatedMembers(unit)`(직접 언급 ∪ 포지션 관련) 기준으로 그 팀원이 걸리는 유닛 수다
  — "팀원 관련" 필터(v1)와 같은 판정 로직이며, v2에서는 이것을 필터 바 안이 아니라 이 프라이머리
  컨트롤로 승격했다. 필터 바(§7)에는 더 이상 별도의 "팀원 관련" 그룹을 두지 않는다(중복 제거).
- pill 한 줄은 **가로 스크롤**(`overflow-x: auto; white-space: nowrap;`)이며 줄바꿈하지
  않는다 — 이름이 많아져도 세로로 불어나지 않고, 오른쪽이 살짝 잘려 보이는 것 자체가 "더
  있다"는 신호다(§0 Baymard 근거).
- 활성 상태는 다른 칩과 같은 언어를 쓴다: `aria-pressed="true"`일 때
  `background: var(--accent); color: #fff; border-color: var(--accent);`. 단일 선택이며,
  이미 선택된 pill을 다시 누르면 선택이 풀린다(토글).
- 선택 시: 카드 목록이 그 팀원의 `relatedMembers(unit)`에 해당하는 카드만 남기고, 결과 수가
  "피드백 n/m"으로 갱신되며, §5의 이름 강조와 멘션 배지("직접 언급"/"포지션 관련(참고)")가
  카드마다 적용돼 자기 잘못과 참고용을 구분해 보여준다. 이것이 필터 그룹들과 **AND**로
  결합되는 다섯 번째 조건이다(§7). **30초 기준**(§15 판정 기준 2): 직접 언급 카드가 포지션
  관련 카드보다 먼저 보여야 팀원이 근거를 빨리 찾는다 — VIEWER_JS가 `.card-list`에
  `.mine-active`를, 직접 언급 카드에 `.is-direct`를 토글하고, `.card-list.mine-active
  .card:not(.is-direct) { order: 1; }`(카드 목록은 flex column)로 DOM 순서를 바꾸지 않은 채
  직접 언급 카드를 시각적으로 앞세운다. 각 그룹 내부는 원래 시간순을 유지한다(flex `order`는
  동순위 항목의 소스 순서를 보존한다). 선택 해제 시 두 클래스 모두 제거한다.
- pill의 최소 히트 영역은 44×44px(§13 접근성)다.

이 컨트롤이 필터 바 안이 아니라 별도 섹션인 이유(§1 원칙 1): "내 피드백을 보고 싶다"는
의도는 일반 필터링 의도보다 훨씬 빈번해 항상 먼저 눈에 띄어야 한다 — 필터 바의 기본 닫힘
(§7) 안에 숨기지 않고 언제나 펼쳐 둔다.

## 7. 필터 바

필터 그룹은 3개(팀원 관련 그룹은 §6으로 승격되어 여기 없다), 그룹 간 **AND**:

| 그룹 | 선택 방식 | 그룹 내부 결합 |
|---|---|---|
| 포지션 트리 | 단일 선택 | — |
| 주제 | 다중 선택 | **OR** |
| 언급 선수 | 단일 선택 | — |

### 세션 전체 0건은 숨기고, 선택 조합 0건은 비활성화한다

세 그룹 모두, **이 세션 전체(m건) 기준으로 결과가 1건 이상인 옵션만 빌드 시점에 DOM에 렌더한다** — 세션 전체에 아예 없는 옵션은 지금도 완전히 숨긴다(§1 원칙 4). 각 옵션 라벨 옆에 개수를 괄호로 표시한다(예 "빌드업 (5)").

**렌더된 옵션의 개수는 실시간(live)이다** — 사용자 피드백("누를 게 있는 포지션만 누르게 해달라")을 반영해 고정 개수 계약을 대체한다. 다른 그룹(§6 "내 피드백" 포함)에 선택이 있으면, VIEWER_JS가 각 옵션의 개수를 "자기 그룹 선택만 뺀 나머지 활성 조건을 모두 만족하는 카드 수"로 선택이 바뀔 때마다 다시 계산한다(표준 패싯 검색) — 주제 그룹은 자기 자신의 선택이 자기 옵션 개수에 영향을 주지 않아 내부 OR가 유지된다. 선택이 없으면 이 개수는 빌드 시점 고정 개수와 같다. **재계산한 개수가 0인 옵션은 지우지 않고 `disabled` 속성 + `aria-disabled="true"` + 흐린 스타일로 남긴다**(레이아웃이 튀지 않는다) — 클릭도 되지 않는다. **이미 선택된 옵션은 절대 비활성화하지 않는다**(조합이 0건이 되어도 해제할 수 있어야 한다).

- **포지션 트리**: 빌드 시점에 결과 있는 리프 노드 + 그 조상만 가지치기해 렌더한다(예: FB 태그가 없으면 FB/LB/RB/LWB/RWB는 전부 빠지고, DF는 CB만 있어도 조상이라 남는다). 각 노드의 개수는 `posClosure(node) = ∪(anc(t) ∪ desc(t))`(자기 자신+조상+자손 폐포) 카드 수 — FB 선택은 LB 태그 카드를 포함하고 역도 성립하되, CB·LB처럼 공통 조상만 있는 가지는 매칭하지 않는다. 자식이 있는 노드(`.pos-node--branch`)는 2열 행이다 — 자기 칩이 왼쪽 고정 열, 자식들이 오른쪽 열에서 줄바꿈한다(`grid-template-columns: minmax(64px, max-content) minmax(0, 1fr)`). 뿌리(GK/DF/MF/FW) 각각은 `.pos-tree`(세로 flex column)에서 독립된 행이 되어, 1440px에서 모든 뿌리·자식 칩이 한 줄로 흘러 붙는 결함(§15-10)을 막는다. 이 2열 규칙은 깊이와 무관하게 동일해, FB의 자식(LB/RB/LWB/RWB)도 FB 자신의 오른쪽 열 안에서 같은 규칙·들여쓰기로 또 하나의 행을 이룬다. 자식 노드(leaf)는 `min-width: 0; max-width: 100%;`로 모바일 폭 안에서 줄바꿈한다 — `overflow: hidden`으로 잘라내지 않는다(390px 칩 잘림 결함 방지).
- **주제**: 이 세션에서 1건 이상 쓰인 태그만 옵션으로 렌더하고, 각 옵션에 개수를 표시한다.
- **언급 선수**: `member_ids`에 1번이라도 등장한 팀원만 옵션으로 렌더하고, 등장 유닛 수를
  개수로 표시한다.

### 활성 필터 요약

필터 바 바로 아래(결과 수 위)에 활성 필터 칩을 상시 노출한다: 그룹마다 선택된 값을
"라벨: 값" 칩으로 나열하고, 각 칩에 `×`(그 칩 하나만 해제) + 맨 끝에 "전체 해제" 버튼
(`--radius-full` pill, §6의 "내 피드백" 선택도 함께 해제)을 둔다. 활성 필터가 없으면 이
줄 자체를 렌더하지 않는다.

### 결과 수 · 기본 접힘 · 빈 상태

- **결과 수**: "피드백 n/m"(n=현재 표시, m=전체).
- **기본 접힘(모든 폭)**: 필터 바 전체가 `<details><summary>필터 (n)</summary>...</details>`로, `open` 없이 기본 닫힘이다(§6 "내 피드백"은 접히지 않는다). 2차 시각 QA에서 데스크톱 기본값이던 `open`이 1440×900·1024×768 모두 카드 목록을 fold 밖으로 밀어내는 것이 확인돼 모바일·데스크톱 모두 기본 닫힘으로 통일했다(필터는 §1 원칙 4의 보조 도구). `n`은 활성 그룹 수(포지션/주제/언급 선수, 주제는 태그 개수와 무관하게 1). `<summary>`는 요약도 보여 닫힌 채로도 무엇이 걸려 있는지 알 수 있다(예 "필터 (2) · 포지션 FB, 주제 빌드업").
- **닫힌 줄 모양(모든 폭)**: `summary`는 `justify-content: space-between`인 전체 폭 한 줄(라벨 왼쪽, `▾`/`▴` 오른쪽, `min-height: 44px`, §4의 `.toc-toggle`과 동일)이고, 패딩은 `[open]`일 때만 안쪽 콘텐츠에 준다 — 닫힌 상태가 세로로 길쭉한 상자가 아니라 요약 한 줄로 보이게 한다. 1024px 미만은 `.layout`의 `align-items: stretch`(§4)로 이 줄도 전체 폭이다.
- **빈 상태는 AND 조합이 0건일 때만 나온다.** 패싯 칩(포지션·주제·언급 선수)은 선택 조합이 0건이 되는 순간 이미 비활성화되므로, 패싯 칩만으로는 빈 상태에 도달할 수 없다(위 라이브 카운트 규칙) — 실제로 도달하는 경로는 필터를 먼저 고르고 그다음 §6 "내 피드백" 대상을 골라 그 조합이 우연히 0건이 되는 경우뿐이다(pill은 비활성화 대상이 아니라 빌드 시점 카운트 그대로다). 0건이면 카드 목록과 목차 항목이 모두 사라지고 §11의 빈 상태를 보인다.

## 8. 목차 탭

`<div role="tablist">` 안에 탭 2개, `<button role="tab" aria-selected="true|false"
aria-controls="...">`로 구현한다:

- **경기별**: 경기 → 주제 → 피드백 3단 트리. 각 주제 노드는 `topics[].summary` 요약을 함께
  보인다.
- **주제별**: 경기 무관, 주제 태그 → 피드백 목록. 태그 옆에 개수를 괄호로 표시(`빌드업 (5)`).

스캔하기 쉽도록: 경기 제목(H2)과 주제 그룹 헤더 사이 간격을 `--space-6`으로 벌리고, 각 유닛
항목은 시간 칩 + 제목만 한 줄로 짧게 보인다(카드 전체 내용을 목차에 복제하지 않는다).

TOC 항목 클릭은 **seek하지 않는다** — 대상 카드로 스크롤(`scrollIntoView`,
`scroll-margin-top` 적용) 후 `.card--highlighted`(`--accent` 보더 2px, 600ms 후 제거)와
그 TOC 항목의 `.is-current`(같은 600ms에 제거)를 함께 준다. 필터·"내 피드백"으로 숨겨진
카드에 해당하는 TOC 항목은 함께 숨긴다 — 항목을 숨긴 결과 그 경기/주제 그룹에 보이는 항목이
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
- **onReady 이전 큐**: `onReady` 전에 클릭이 들어오면 seek/load 요청을 큐에 저장하고,
  `onReady`에서 순서대로 flush한다.
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
- **임베드 불가 플레이스홀더**: 영상별로 판정한다. `embeddable: false`면 iframe 대신
  플레이스홀더(썸네일 또는 텍스트 카드 + "유튜브에서 시청 ↗")를 보인다. 카드에서 전환한
  경우 새 탭 링크는 그 카드의 시작 시각을 가리킨다. 각 카드의 "유튜브에서 보기 ↗"(§5)는
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
| `text-wrap` | 제목 `balance`, 본문 `pretty` | 제목은 균형, 본문은 마지막 줄 orphan 방지 |

최소 크기·행간은 §2 타입 스케일을 따른다(본문 16px 이상, 행간 1.6–1.7). `word-break: keep-all`/`text-wrap: pretty`는 단어 경계에서만 줄을 바꾸므로 부정(-지 못/않)·의존명사(수/것과 그 축약형 게/거/걸/건/겁)·"-기 전/시작"·"-다 보니"·숫자(아라비아 숫자 또는 한/두/세... 고유어 수사)+단위 같은 **묶인 문법 구성**의 중간 줄바꿈까지는 막지 못한다 — `render.ts`의 `glueKorean()`이 그 구성 안의 공백을 U+00A0로 바꿔 렌더 단계에서 막는다(§15-1). 구성 경계에 `**` 볼드 마커가 붙어도(마커가 공백 앞에서 닫히든 공백 뒤에서 열리든) 같은 공백이 nbsp로 치환된다. 받침 판정(-ㄹ/-ㄴ 관형사형, 예 "앞당겨질 것", "할 수 있다")은 융합 음절의 유니코드 코드포인트에서 종성 인덱스를 직접 계산해 감지한다 — 실제 문장에 나타나지 않는 낱자모 ㄹ/ㄴ 문자를 정규식에 직접 넣는 방식은 오탐이 아니라 미탐(never-matches) 버그였다. 여러 묶인 구성이 공백 하나 간격으로 연쇄되면(예 "찾기 시작하다 보니") 한 구간이 통째로 줄바꿈 불가능해질 수 있어, nbsp로 이어붙인 한 구간이 14자(390px 컬럼에서 Body 크기 기준)를 넘으면 그 안의 이음매 하나를 도로 공백으로 되돌려 끊는다(§15-1). 독립된 두 단어 사이의 통상적인 어절 줄바꿈(예 "수비 전환", "출발 신호")은 결함이 아니다 — 차단 판정은 묶인 문법 구성 한정이다. `visual-qa`의 CJK 검사(조사/어미 고아 줄, 제목류의 주어-술어 분리, 연결어 중간 분리, 짧은 인용/출처 영문 줄바꿈, 제목 한 글자 고아 줄)는 전수 검사이며 표본 추출을 허용하지 않는다(§13) — 본문 문단·캡션의 통상적인 어절 줄바꿈과 §12 번역 표 원문 전체 문장의 줄바꿈은 검사 대상에서 제외한다(라운드6 CJK 검토: 둘 다 구조적으로 막을 수 없거나 막을 필요가 없는 일반 줄바꿈이다).

## 11. 빈 상태

| 상황 | 표시 |
|---|---|
| 필터 AND 조합 결과 0건 | "조건에 맞는 피드백이 없어요" + 리셋 버튼. 카드 목록·목차 항목 모두 숨김(§7) |
| 빈 아카이브(발행된 세션 없음) | 아카이브 첫 페이지에 "아직 발행된 세션이 없어요." 텍스트만, 세션 카드 그리드 없음. **이 상태도 세션 페이지와 같은 셸/토큰/푸터 고지를 쓰는 `renderIndex` 출력이어야 한다** — 별도의 하드코딩된 플레이스홀더 HTML 경로를 두지 않는다 |
| 본문에 프레임 없는 유닛 | 대표 시작 이미지(§5-3)는 항상 렌더하되, 본문은 text 블록만으로 구성된다 — 빈 figure나 플레이스홀더 박스를 만들지 않는다 |
| disabled 모드(팀원 명단 없음) | "내 피드백"(§6)과 "언급 선수" 필터를 화면과 키보드 조작 모두에서 렌더하지 않는다(존재하지 않는 명단으로 이름을 지어내지 않는다). 카드의 "언급된 팀원"·"관련 팀원" 줄도 렌더하지 않는다. 유사 과거 피드백 섹션은 명단 유무와 관계없이 생략한다. 포지션·주제 필터와 본문·이미지는 명단과 무관하게 정상 제공한다 |

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

- 세션 카드를 최신순(날짜 desc)으로 나열: 날짜, 제목, 파트 수, 피드백 개수, 주제 칩 목록.
  타입 스케일·색·간격 토큰은 세션 뷰어와 동일하다(§2). 카드 전체가 클릭 타깃이지만
  `color: var(--ink); text-decoration: none;`로 카드 전체에 밑줄을 걸지 않는다 — 날짜는
  `--muted`로 작게, 제목만 hover/focus 시 `--accent` 색+밑줄을 받는다(밑줄이 클릭 타깃
  경계가 아니라 제목 하나를 가리키게 한다).
- "주제별 전체 피드백" 링크 — 아카이브 전체를 가로지르는 주제별 뷰로 이동.
- 빈 상태는 §11 참고(같은 렌더러 출력이어야 한다).
- 푸터 고지: "팀 내부 피드백용 비공식 정리 문서입니다. 영상 저작권은 원게시자에게
  있습니다."(원문 그대로 — "원 게시자"로 띄어 쓰면 390px에서 "원"이 고아 줄로 남는다, §10) —
  세션 페이지 푸터와 동일 문구.

### 참고자료(refs) 페이지

- 제목, `kind`(`eafc`/`tactics`) 배지 + 언어 배지, 원문 링크("원문 ↗", 새 탭).
- 한국어 요약(`summary_ko`), 핵심 포인트 목록(`key_points_ko`) — Body 크기(1.0625rem/1.7,
  §2)로 세션 카드 본문과 같은 가독성을 준다(요약이라고 작게 줄이지 않는다).
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
  `.seek-btn`, details summary의 클릭 가능 영역은 최소 44×44px(작은 시간 칩처럼 시각 크기를
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
| 9 | `filter-mention-390` | session | 언급 선수 필터 선택 | 390×844 |
| 10 | `filter-mention-1440` | session | 언급 선수 필터 선택 | 1440×900 |
| 11 | `my-feedback-390` | session | "내 피드백"에서 팀원 1명 선택(§6) | 390×844 |
| 12 | `my-feedback-1440` | session | "내 피드백"에서 팀원 1명 선택(§6) | 1440×900 |
| 13 | `filter-empty-and-390` | session | 서로 다른 두 그룹(예 포지션+주제) 조합 결과 0건 | 390×844 |
| 14 | `filter-empty-and-1440` | session | 서로 다른 두 그룹(예 포지션+주제) 조합 결과 0건 | 1440×900 |
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
| 34 | `disabled-mode-390` | session | 팀원 명단 없이 렌더(§11 disabled 모드): "내 피드백"·언급 선수 필터·카드의 "언급된 팀원"/"관련 팀원" 줄·@멘션 칩이 모두 미노출 | 390×844 |
| 35 | `embed-blocked-390` | session | `embeddable: false`인 파트의 임베드 불가 플레이스홀더(썸네일 또는 텍스트 카드 + "유튜브에서 시청 ↗", §9) | 390×844 |
| 36 | `my-feedback-related-390` | session | 내 피드백 윤도훈 선택 후 첫 '포지션 관련(참고)' 카드까지 스크롤 — 참고 배지 대비 확인 | 390×844 |
| 37 | `my-feedback-related-1440` | session | 내 피드백 윤도훈 선택 후 첫 '포지션 관련(참고)' 카드까지 스크롤 — 참고 배지 대비 확인 | 1440×900 |

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
  정확히 갱신되며, `.card-list.mine-active`에서 `.is-direct`(직접 언급) 카드가 먼저 온다.
  **멘션 배지**는 `data-member-ids`면 "직접 언급", `data-related-ids`만이면 "포지션
  관련(참고)"를 보인다.
- **텍스트 선택 중 seek 무시**: 드래그 선택 중인 카드를 클릭해도 재생 상태가 바뀌지 않는다.
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

1. **CJK 줄바꿈 위반**(§10): 조사/어미 고아 줄, 제목류(H1/H2/H3·카드 제목·TOC 라벨·아카이브 카드 제목)의 주어-술어 분리, 묶인 문법 구성(부정 -지 못/않, 의존명사 수/것/게/거/걸/건/겁, -기 전/시작/위해/때문, -다 보니/보면, 숫자+단위 등)의 중간 분리, 짧은 인용/출처 영문 문자열(따옴표 인용, 제목) 줄바꿈, 제목 한 글자/음절 고아 줄, 글리프 깨짐(tofu) — 페이지 전수 검사. 독립된 두 단어 사이의 통상적인 어절 줄바꿈(예 "수비 전환")과 본문 문단·캡션 안의 어절 단위 주어-술어 줄바꿈(예 "상대 수비가 / 좁혀지는")은 결함이 아니다 — 일반적인 한글 어절 줄바꿈이라 구조적으로 막을 수 없다. §12 번역 표 원문 전체 문장의 줄바꿈도 결함이 아니다(<1024px 스택 레이아웃에서 전체 폭으로 줄바꿈된다).
2. **토큰 이탈**: §2에 없는 raw hex, 임의 px 간격/반경, §2 타입 스케일에 없는 폰트 크기.
3. **레이아웃 계약 위반**(§4): 1024px 이상에서 `.player-wrapper`/`.part-switch`에
   `flex-shrink: 0`이 빠져 플레이어가 보이지 않거나 찌그러짐, `.main`이 단일 wrapper가
   아니라 개별 요소로 흩어짐, 1024px 미만에서 sticky 플레이어 높이가 `min(56.25vw, 200px)`을
   넘어 본문을 밀어냄, 카드가 sticky 플레이어에 가려짐(`scroll-margin-top` 누락/오계산),
   카드 스크롤 중 sticky 고정이 풀림(`.side-col`의 `display: contents` 누락 등), "플레이어
   접기" 버튼의 `aria-expanded` 불일치.
4. **카드 필드 누락/순서 오류**(§5): 태그 행→언급된 팀원→본문→관련 팀원 순서가 아님, 시간
   칩이 m:ss/h:mm:ss 분기를 따르지 않음, ko 참고자료에 "요약" 링크가 잘못 노출(또는 비-ko에
   없음), 대표 이미지에 width/height가 없어 레이아웃 시프트, 본문 프레임에 캡션·"확대" 링크가
   없거나 새 탭/`rel="noopener"` 없이 열림, 멘션 배지가 미선택 상태에 나타나거나 종류가
   `data-member-ids`/`data-related-ids` 판정과 다름(직접 언급 ↔ 포지션 관련(참고) 뒤바뀜).
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
    줄바꿈됨, 플레이어가 안 보이거나 찌그러짐, 콘텐츠로 설명 안 되는 160px 넘는 빈 공백이
    있음, 팀원이 자기 피드백을 찾는 데 "내 피드백" pill 1회 탭을 넘는 조작이 필요함, 헤더에
    제목+날짜 외의 요소(칩·버튼·아이콘 등)가 섞여 산만함.

차단이 아닌 항목: 서브픽셀 렌더링 차이, 폰트 힌팅에 따른 안티앨리어싱 차이, 브라우저별
스크롤바 폭 차이로 인한 1–2px 디프.
