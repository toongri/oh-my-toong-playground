# FSD(Feature-Sliced Design) 아키텍처 판단 규칙

레이어·슬라이스 배치를 다루는 규칙이다. 상시 적용되는 핵심 판단은 아래에, 상황별 세부 판단은 문서를 열어 확인한다.

- **pages-first**: 새 화면 전용 코드는 Page slice에서 시작한다. 미래 재사용을 대비한 Feature/Entity/Widget 선분해는 금지 — 실제 두 번째 소비자가 생기고 이름 붙일 수 있는 안정된 public API가 드러났을 때만 추출한다.
- **import 방향**: App → Pages → Widgets → Features → Entities → Shared로 하향만 허용. 같은 레이어의 다른 slice를 직접 import하지 않는다(cross-feature 공유의 해소는 `feature-boundary.md` rule 참조).
- **진입점 경유**: 다른 slice는 그 slice의 public API(진입점)로만 import한다.
- **Shared의 한계**: Shared에는 도메인 정책·워크플로를 두지 않는다(infrastructure만).
- **route 파일**: 프레임워크 route 파일은 얇게 유지하고 Page로 위임한다.
- **배치가 애매할 때**: docs를 열어 다섯 질문을 통과시킨다.

- `docs/architecture/layers.md` — **FSD 전제·레이어별 책임**: 핵심 원칙(slice·public API·하향 의존), 의존 규칙(같은 레이어·App/Shared 예외·Processes), slice·segment(ui·model·api·lib·config), pages-first, App·Pages·Widgets·Features·Entities·Shared 적합·부적합 책임, Next.js 디렉토리 매핑(_app·_pages), route entry 두께 관례, RSC 경계와 FSD 레이어의 관계, 흔히 빠지는 함정(overslicing·Shared landfill·obese Entity)
- `docs/architecture/placement.md` — **배치 판단**: 경계 판단 다섯 질문, 배치 decision tree, 책임별 배치 매트릭스(hook·type·constant·HTTP client·서버 상태·클라이언트 상태·form·validation·auth·analytics·feature flag·i18n·generated API), store 배치, 같은 레이어 import 해소 사다리
- `docs/architecture/public-api.md` — **public API·진입점**: barrel vs public API, index.ts 규칙(진입점 위치·상대 경로·export-star), @x 표기, shared/ui 컴포넌트별 진입점(tree-shaking), index.server.ts
- `docs/architecture/error-layers.md` — **에러 처리 계층**: 계층 구성(컴포넌트·페이지·전역 Boundary·HTTP 공통), 실패 종류별 처리 위치, throwOnError, Suspense 쌍 배치, 이벤트 핸들러·비동기 에러의 Boundary 한계
- `docs/architecture/design-process.md` — **설계 프로세스**: 변경 영향 범위 질문, RADIO 5단계, RFC(스켈레톤·작성 3원칙), FSD 점진 마이그레이션·strangler
- `docs/architecture/cases-auth.md` — **인증 분해 사례**: 로그인 폼 위치(pages/widget), 폼 검증 스키마 위치, 토큰 저장 옵션별 트레이드오프(shared/api·entities·쿠키), 로그아웃 처리 위치, 갱신 실패 failsafe
- `docs/architecture/cases-state-ownership.md` — **상태 소유권 사례**: 원본 이중화(URL·store), query key 조건 누락, queryOptions 콜로케이션, mutation 후 invalidation(prefix·exact), 폼 상태의 전역 store 배치, 파생값 저장, selector 구독 범위, store의 슬라이스 위치(entities vs features)
- `docs/architecture/cases-api-and-types.md` — **API·타입 배치 사례**: 요청 함수 공유/전용(shared/api/endpoints), 응답 타입과 entities 타이밍, query 훅 콜로케이션, shared/types 이슈, 엔티티 간 타입 순환(@x), enum·zod 스키마·RootState·앰비언트 선언·자동생성 타입 위치
- `docs/architecture/cases-structure.md` — **구조·경계 사례**: widget/feature 승격 판단(재사용 범위), 레이아웃 배치(shared·app·주입), slice 폴더 그룹핑, segment 명명(형태/목적), shared/lib 그룹핑, 경계 린트 강제(ESLint zones·Steiger 규칙), barrel과 tree-shaking 긴장, Next route handler·DB 쿼리 위치
- `docs/architecture/cases-ui-flows.md` — **구체 UI 흐름 배치 사례**: 모달·다이얼로그 위치(전역 매니저·로컬·widget), 페이지네이션·필터·정렬(URL·query key·소유 결합, key factory), 다단계 폼·마법사, 찜·좋아요 optimistic update(variables/cache), 권한별 UI 분기(route guard·domain rule·세션 infra), analytics 이벤트 호출 위치

**관련 규칙**: cross-feature 공유·조립 판단은 `feature-boundary.md` rule에, 상태 구조·위치·분류는 `react.md` rule에, App Router 렌더링 경계·데이터·자산은 `nextjs.md` rule에 있다.
