# 애매한 책임은 어디에 두는가

배치가 애매한 코드는 아래 다섯 질문에 순서대로 답하면 대부분 정리된다. 각 레이어가 원래 무엇을 위한 곳인지는 [`./layers.md`](./layers.md)에 있다 — 이 문서는 그 경계선 위에 걸친 애매한 케이스를 다룬다.

## 경계 판단 다섯 질문

1. 현재 독립 소비자는 몇 개인가?
2. 이 코드가 변경되는 이유는 화면, user action, domain concept, infrastructure 중 무엇인가?
3. public API를 한 문장으로 이름 붙일 수 있는가?
4. 새 위치로 옮겼을 때 import가 아래로만 흐르는가?
5. 원래 Page에 남겨두면 실제로 어떤 문제가 생기는가?

**5번에 구체적인 답이 없으면 Page에 남기는 것이 v2.1에 가장 가깝다.** "언젠가 재사용할 것 같다"는 구체적 답이 아니다.

## 배치 decision tree

1. 기존 owner가 있는가? 있으면 그 slice를 수정한다.
2. 한 Page에만 쓰이는가? Page에 둔다.
3. domain-independent infrastructure인가? Shared에 둔다.
4. 현재 여러 소비자가 쓰는 완전한 user action인가? Feature를 검토한다.
5. 현재 여러 소비자가 공유하는 안정된 domain concept인가? Entity를 검토한다.
6. 여러 Page에서 재사용되는 독립 대형 UI인가? Widget을 검토한다.
7. 같은 레이어/upward import가 필요한가? 아래 "같은 레이어 import가 필요할 때" 사다리를 순서대로 밟는다.

## 배치 매트릭스

| 책임 | 권고 배치 | 핵심 근거 |
| --- | --- | --- |
| CRUD | 위치 고정 없음 | transport는 Shared, 안정된 Entity API는 Entity, 화면 action은 Page/Feature |
| React hook | 목적에 따라 `ui`/`model`/`api` | hook이라는 이유만으로 Shared에 두지 않는다 — 무엇을 하는 hook인지가 배치를 정한다 |
| Type/interface | co-change owner | DTO는 API owner, domain type은 Entity, workflow payload는 Feature/Page |
| Constant | co-change owner | protocol/token/route처럼 범용이면 Shared, domain rule이면 owner |
| HTTP client | base는 Shared/api | base URL·auth header·retry는 Shared, endpoint/query/mapping은 owner |
| 서버 상태(Query cache) | owner의 `api`/`model` | 화면별 filter/pagination은 Page/Widget, 여러 화면이 공유하는 안정 resource primitive만 Entity/api |
| 클라이언트 상태 | 가장 낮은 owner | local first, reusable workflow는 Feature/model, root store setup은 App |
| Form | Page | 화면 전용은 Page, 재사용 action만 Feature |
| Validation | Entity 또는 Page/Feature | Entity invariant는 Entity, submit/workflow rule은 Page/Feature |
| Cross-Entity rule | 실제 행위를 소유한 상위 책임 | Page/Widget/Feature 중 그 행위를 소유한 곳 — 한 Entity에 몰아넣지 않는다 |
| UI primitive | Shared/ui 또는 Widget | domain을 모르면 Shared, business composition이면 Widget |
| Layout | Shared/App/Page | primitive는 Shared, global assembly는 App, route-specific는 Page |
| Routing | App + Page | router/init은 App, route 결정은 Page 이상, 하위엔 props/composition으로 전달 |
| Provider | App 또는 가장 가까운 owner | 전역 lifecycle만 App, 좁은 provider는 소비자 근처 |
| 인증(Auth) | App/Shared/Entity/Page/Feature로 분해 | bootstrap은 App, credential transport는 Shared, user state는 Entity, login UI는 Page/Feature |
| Analytics | SDK Shared, init App | global plumbing은 App, 이벤트 의미(무엇을 언제 보낼지)는 Page/Feature 근처 |
| Feature flag | SDK/provider는 Shared/App | flag infrastructure만 전역, variation UI/행동은 owner |
| i18n | infrastructure Shared | runtime/catalog는 Shared, domain message key는 owner |
| 접근 제어(Access control) | App/Shared/Entity/Feature로 분해 | domain authorization은 해당 flow/Entity rule, route guard는 App/Page, session infrastructure는 Shared/App |
| Generated API | 별도 경계 | generated tree는 좁은 glob으로 격리, hand-written domain adapter는 owner |

## store는 몇 개의 기능이 함께 쓰는가로 정한다

같은 "장바구니" 상태도 관점에 따라 `entities/cart/model`과 `features/add-to-cart/model` 둘 다 말이 된다. 판단은 **"이 상태를 몇 개의 기능이 함께 쓰는가"**다.

| 관점 | `entities/cart/model` | `features/add-to-cart/model` |
| --- | --- | --- |
| 논리 | "장바구니"는 도메인 개념이다 | store는 "담기 행위"의 세부 구현이다 |
| 유리한 상황 | 여러 행위(담기·수량변경·삭제·주문)가 상태를 공유 | 한 가지 행위에서만 사용 |
| 리스크 | 행위 로직이 Entity로 흘러들어 obese Entity가 된다 | feature 간 직접 의존 유혹이 생긴다 |

**한 페이지에서만 쓴다면 우선 그 페이지에 둔다.** Entity로 올리는 것은 실제로 여러 Feature가 같은 상태를 공유하게 됐을 때다.

## 상태 원본(Source of Truth)이 FSD 배치보다 먼저다

서버 상태(Query cache) · URL 상태 · 전역 클라이언트 상태 · 로컬 상태 네 종류는 각각 원본이 다르다. **어느 레이어/slice에 둘지보다 무엇이 원본인지를 먼저 정한다** — 원본이 정해지면 FSD 배치는 "그 원본을 누가 소유하는가"로 자연히 따라온다. 예를 들어 검색 조건의 원본이 URL이면, FSD 레이어에서도 그 조건은 URL을 읽는 owner(대개 Page) 바깥으로 복제되지 않아야 한다. 상태 분류 자체의 상세 기준은 이 문서에서 다시 설명하지 않는다 — [`../react/context-and-state.md`](../react/context-and-state.md)와 `../../.claude/rules/react.md`가 다룬다.

## 같은 레이어 import가 필요할 때

deep import나 임의 Shared 이동으로 해결하지 않는다. 순서대로 밟는다.

1. **항상 함께 바뀌면 slice를 합친다.** 두 slice가 매번 같이 수정된다면 경계가 틀린 것이다.
2. **상위 레이어(Page/Widget)에서 composition한다.** 두 Feature가 협력해야 하면 그 둘을 아는 상위가 props로 배선한다. 레이어가 적은 구조(App/Pages/Shared만 쓰는 초기 단계)에서는 App이 그 상위 조립 지점이 된다 — 조립 지점이 항상 "widget"이라는 이름을 가질 필요는 없다.
3. **props/context/factory로 의존을 역전한다.** 하위가 상위의 존재를 몰라도 되게 만든다 — `layers.md`의 `ProductCard`/`actions` 예시가 이 패턴이다.
4. **진짜 business-independent면 Shared로 내린다.** "여러 곳에서 쓴다"만으로는 부족하다 — Shared landfill이 되지 않으려면 도메인 무관인지 먼저 확인한다.
5. **Entity 관계에 한해 승인된 `@x` 표기를 검토한다.** Entity 외 레이어에서는 쓰지 않는다. 자세한 조건은 [`./public-api.md`](./public-api.md).
6. **그래도 모호하면 architecture decision으로 에스컬레이션한다.** 개인 판단으로 deep import나 lint suppression을 넣지 않는다.

이 사다리는 FSD 6개 레이어 전체에 걸친 배치 판단이다. 레이어가 적은 단순 구조(`features/`+`app/`)에서 cross-feature 공유를 판단하는 3분기는 이미 [`../react/feature-boundary.md`](../react/feature-boundary.md)에 있다 — 타입/순수 유틸을 shared로 내리고, UI 조합은 상위(app)에서 하고, 항상 같이 바뀌면 병합한다는 그 판단은 여기서도 동일하게 적용되며, 이 문서는 그 판단이 App뿐 아니라 Widget/Entity까지 포함한 6계층 전체에서 어떻게 갈라지는지를 다룬다.

## 근거

- [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)
- [FSD — Public API](https://feature-sliced.design/docs/reference/public-api)
- [Redux Style Guide](https://redux.js.org/style-guide/)
