# 코드 전에 설계를 쓴다 — RADIO와 RFC

"이 파일을 어디에 둘까"보다 중요한 질문은 "이 변경의 영향 범위는 어디까지인가"다. 시스템 설계는 변경이 다른 코드에 미치는 영향을 줄이는 일이다.

## RADIO — 설계 결정을 빠뜨리지 않는 5단계

| 단계 | 질문 | 커머스 적용 예 |
| --- | --- | --- |
| Requirements | 무엇을 만드는가, 보존할 동작과 하지 않을 것은 무엇인가 | 상품 목록 무한 스크롤·장바구니는 유지, 실시간 재고 동기화는 이번 범위 밖 |
| Architecture | 어떤 구조인가 | FSD 레이어 구성, 서버 상태·클라이언트 상태·URL 상태 구분 |
| Data Model | 어떤 데이터를 다루는가 | Product/Order/CartItem 모델, Source of Truth 위치 |
| Interface | 슬라이스·컴포넌트 간의 약속은 | 슬라이스 public API, Props/이벤트 계약 |
| Optimization | 성능·에러 전략은 | 캐시 정책, Error Boundary 배치 |

작성 깊이는 문제의 규모에 맞게 조절한다. 아직 정하지 않은 항목도 적어둔다 — "Optimization은 이번에 다루지 않는다"는 빠뜨린 것이 아니라 이번에는 하지 않기로 한 결정이다. 다루지 않는다고 적어야 나중에 그 항목을 빠뜨렸는지 일부러 미뤘는지 구분할 수 있다.

## RFC — 피드백을 구현 앞으로 당기는 장치

같은 구조적 피드백도 늦게 받을수록 반영 비용이 커진다.

```text
RFC 없이:  구현 3일 → 리뷰에서 구조 지적 → 재작업 2일 → …   ≈ 7일+
RFC 적용:  RFC 반나절 → 구조 합의 1일 → 구현 2일 → 리뷰      ≈ 3.5일
```

코드를 다 짠 뒤에 "이 구조로는 확장이 어렵다"는 피드백을 받으면 재작업 범위가 이미 짠 코드 전체다. RFC 단계에서 같은 피드백을 받으면 재작업 범위는 문서 한 문단이다.

### RFC 스켈레톤

```markdown
# RFC: 커머스 아키텍처 재설계

## 1. 배경 — 지금 코드에서 겪는 문제
   - cart가 product의 hook을 직접 import하기 시작했다

## 2. 제안 — 한 문단 요약

## 3. 상세 설계 — Before/After 트리 · 의존 규칙 · 파일 매핑

## 4. 트레이드오프 — 비용 · 학습 곡선 · 소규모 프로젝트의 부담

## 5. 대안 검토 — 선택하지 않은 안과 그 이유

## 6. 마이그레이션 — Phase 분할 + Phase별 검증
```

### RFC 작성 3원칙

1. **지금 겪는 문제를 쓴다** — "FSD가 좋다니까"가 아니라 "ProductCard를 어디 둬야 할지 팀원마다 다르게 판단한다"처럼, 배경은 일반론이 아니라 지금 코드에서 실제로 겪는 문제여야 한다.
2. **트레이드오프를 공개한다** — 장점만 쓰면 RFC가 아니라 광고다. 단점과 선택하지 않은 대안까지 써야 팀이 제대로 판단할 수 있다.
3. **단계를 분리하고 검증 기준을 남긴다** — 각 Phase에서 무엇을 확인하고 언제 되돌릴지 적는다. 분량은 A4 2~3장이면 충분하다 — 너무 길면 아무도 읽지 않는다.

## FSD 점진 마이그레이션 순서

전체 트리를 한 번에 옮기지 않는다. strangler 방식으로, 앞으로 새로 쓰거나 수정할 flow부터 옮긴다.

1. 지금 겪는 pain과 지켜야 할 불변 조건을 기록한다.
2. 새로 쓰거나 수정하는 flow부터 App, Pages, Shared를 적용한다.
3. Page 안에 ui/model/api를 co-locate한다 — 아직 Feature/Entity로 나누지 않는다.
4. 실제 두 번째 소비자가 생긴 코드만 Feature/Entity/Widget으로 추출한다.
5. architecture lint(Steiger 등)를 warning으로 도입한다.
6. alias·generated-code·framework 경계에서 나오는 오탐을 확인한 뒤 error로 승격한다.
7. 남겨야 하는 exception에는 이유·owner·review date를 남긴다.

옛 구조와 새 구조가 한동안 공존해도 된다. 목표는 전체 이동이 아니라, 손대는 코드부터 규칙을 지키게 만드는 것이다.

## 좋은 구조인지 확인하는 질문

기능을 지울 때 함께 지울 코드를 바로 알 수 있는가? 대답이 "아니오"면 그 기능과 관련된 코드가 여러 폴더에 흩어져 있다는 뜻이고, 그 흩어짐이 다음 변경의 영향 범위를 예측하기 어렵게 만드는 원인이다.

## 근거

- [GreatFrontEnd — RADIO Framework](https://www.greatfrontend.com/system-design/framework)
- [Gergely Orosz — Design Docs at Google](https://blog.pragmaticengineer.com/design-docs-at-google/)
- [Feature-Sliced Design — v2.1 migration guide](https://feature-sliced.design/docs/guides/migration/from-v2-0)
