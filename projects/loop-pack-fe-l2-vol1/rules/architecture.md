# FSD(Feature-Sliced Design) 아키텍처 판단 규칙

레이어·슬라이스 배치를 다루는 규칙이다. 상시 적용되는 핵심 판단은 아래에, 상황별 세부 판단은 문서를 열어 확인한다.

- **pages-first**: 새 화면 전용 코드는 Page slice에서 시작한다. 미래 재사용을 대비한 Feature/Entity/Widget 선분해는 금지 — 실제 두 번째 소비자가 생기고 이름 붙일 수 있는 안정된 public API가 드러났을 때만 추출한다.
- **import 방향**: App → Pages → Widgets → Features → Entities → Shared로 하향만 허용. 같은 레이어의 다른 slice를 직접 import하지 않는다(cross-feature 공유의 해소는 `feature-boundary.md` rule 참조).
- **진입점 경유**: 다른 slice는 그 slice의 public API(진입점)로만 import한다.
- **Shared의 한계**: Shared에는 도메인 정책·워크플로를 두지 않는다(infrastructure만).
- **route 파일**: 프레임워크 route 파일은 얇게 유지하고 Page로 위임한다.
- **배치가 애매할 때**: docs를 열어 다섯 질문을 통과시킨다.

- `docs/architecture/fsd-overview.md` — **FSD 개요·도입 배경**: 구조 진화사(기술 계층→Atomic→feature 폴더→FSD), FSD 정의·세 원칙, 레이어 구성, slice·segment(ui·model·api·lib·config), pages-first 버전, Features 코-로케이션과의 차이, 도입·비도입 조건, 대안 비교
- `docs/architecture/layers.md` — **레이어별 책임**: App·Pages·Widgets·Features·Entities·Shared 적합·부적합 책임, Processes 레이어의 지위, 실패 모드(overslicing·Shared landfill·obese Entity)
- `docs/architecture/placement.md` — **배치 판단**: 경계 판단 다섯 질문, 배치 decision tree, 책임별 배치 매트릭스(hook·type·constant·HTTP client·서버 상태·클라이언트 상태·form·validation·auth·analytics·feature flag·i18n·generated API), store 배치, 같은 레이어 import 해소 사다리
- `docs/architecture/public-api.md` — **public API·진입점**: barrel vs public API, index.ts 규칙(진입점 위치·상대 경로·export-star), @x 표기, shared/ui 컴포넌트별 진입점(tree-shaking), index.server.ts
- `docs/architecture/nextjs-fsd.md` — **Next.js 런타임과 FSD 축 분리**: app/·pages/ 이름 충돌(_pages), route entry 두께 관례, RSC 경계와 FSD 레이어의 관계
- `docs/architecture/error-layers.md` — **에러 처리 계층**: 계층 구성(컴포넌트·페이지·전역 Boundary·HTTP 공통), 실패 종류별 처리 위치, throwOnError, Suspense 쌍 배치, 이벤트 핸들러·비동기 에러의 Boundary 한계
- `docs/architecture/design-process.md` — **설계 프로세스**: 변경 영향 범위 질문, RADIO 5단계, RFC(스켈레톤·작성 3원칙), FSD 점진 마이그레이션·strangler

**관련 규칙**: cross-feature 공유·조립 판단은 `feature-boundary.md` rule에, 상태 구조·위치·분류는 `react.md` rule에, App Router 렌더링 경계·데이터·자산은 `nextjs.md` rule에 있다.
