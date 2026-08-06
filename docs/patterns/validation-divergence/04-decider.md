# 패턴 4 — Decider (decide / evolve)

> ⚠️ **이 패턴은 권고사항이며, admin/user 검증 분기 문제의 답이 아니다.** 성격이 다른 문제(순수 판정 + 외부 액션 실행의 분리)를 푸는 도구다. 이 문서에 넣는 이유는, 위 세 패턴과 자주 혼동되기 때문에 "언제 이걸 쓰고 언제 쓰지 말아야 하는지"의 경계를 명확히 하기 위해서다.

출처: Jérémie Chassaing, "Functional Event Sourcing Decider"(thinkbeforecoding.com, 2021-12-17). 더 일반적인 원형은 Gary Bernhardt, "Functional Core, Imperative Shell"(Boundaries, SCNA 2012). 재정식화는 James Shore, "Testing Without Mocks / A-Frame Architecture"(2023).

## 한 줄 요약

순수 함수(`decide`)가 상태를 바꾸지 않고 **"무엇을 할지"를 값(액션/이벤트)으로 반환**하고, 별도의 얇은 실행 셸(서비스)이 그 값을 받아 부수효과를 실행한다. 판정 로직이 100% 순수해져 DB·네트워크·mock 없이 테스트된다.

## 이름에 대하여

이 패턴엔 **단일 표준 이름이 없다.** 같은 형태를 세 커뮤니티가 각자 이름 붙였다. "Plan"은 표준 용어가 아니다(어느 1차 출처에도 없음).

| 이름 | 누가·언제 | 강조점 |
|---|---|---|
| **Functional Core, Imperative Shell** | Gary Bernhardt, 2012 | 가장 오래되고 일반적. "순수 코어 vs 명령형 셸" 두 계층 은유. 도메인 불문 |
| **Decider** | Jérémie Chassaing, 2021 | `decide`/`evolve` 정형. 이벤트소싱 전용 어휘, 합성 가능성까지 형식화 |
| **A-Frame Architecture** | James Shore, 2023 | 위 둘의 실용적 재정식화 |

셋은 상하위 관계다: **FC/IS가 일반 원칙, Decider는 그걸 Command/State/Event 타입과 fold 시그니처로 형식화한 이벤트소싱 특수 사례.**

## 형태 — decide / evolve

Chassaing의 정의(F#):

```fsharp
type Decider<'c,'e,'s> =
    { decide: 'c -> 's -> 'e list      // 커맨드+상태 → 이벤트 목록 (상태 안 바꿈, 순수)
      evolve: 's -> 'e -> 's           // 상태+이벤트 → 새 상태 (fold, 순수)
      initialState: 's
      isTerminal: 's -> bool }
```

- `decide`는 **아무것도 실행하지 않는다.** "이 커맨드를 이 상태에서 처리하면 어떤 이벤트가 생겨야 하는가"만 계산한다.
- `evolve`는 이벤트를 상태에 접어 넣어(fold) 다음 상태를 만든다.
- 실제 부수효과(DB 저장, PG 호출)는 이 둘 **바깥의 셸**이 반환된 이벤트를 소비해 실행한다.

## 예시 — 이벤트소싱 없이 (얇은 절충형)

Chassaing 본인이 "가장 단순한 버전부터 시작하라"고 권한다 — 이벤트 저장 없이 그냥 load/save. 이 레포처럼 이벤트소싱이 아닌 곳에 얹는다면 이 형태다.

```ts
type CancelAction =
  | { type: 'REVERSE_POINTS'; amount: number }
  | { type: 'CANCEL_PG'; paymentKey: string; amount: number }
  | { type: 'MARK_CANCELLED' }

// 순수 판정 — I/O 0. "무엇을 할지"만 값으로 반환. throw 또는 액션 목록.
function decideCancel(order: Order, now: Date): CancelAction[] {
  if (order.status !== OrderStatus.CONFIRMED)
    throw new OrderNotCancellableError(order.id, order.status)
  return [
    { type: 'REVERSE_POINTS', amount: order.usedPoints },
    { type: 'CANCEL_PG', paymentKey: order.paymentKey, amount: order.paidAmount },
    { type: 'MARK_CANCELLED' },
  ]
}

// 셸 = 서비스. 액션을 받아 '실행'만 한다. 데이터는 미리 로드해서 넘긴다.
class OrderCancelService {
  static async cancelByCustomer(orderId: string, userId: string): Promise<void> {
    const order = await OrderRepository.findByUserAndOrderId(userId, orderId)   // 셸이 미리 로드
    const actions = decideCancel(order, new Date())           // 순수 판정 — mock 없이 테스트
    for (const action of actions) await this.apply(action)    // 셸이 실행
  }
}
```

## 장단점

| | 장점 | 단점 |
|---|---|---|
| 테스트 | 판정이 순수 함수라 DB·mock 없이 값 비교로 테스트 | — |
| 관찰가능성 | 부수효과가 데이터(액션/이벤트)라 로깅보다 신뢰도 높은 감사기록. Chassaing: 로그는 "코드와 어긋나기 쉽고 첫 어긋남에서 신뢰가 무너진다" | 이벤트 스키마 관리 부담 |
| 흐름 추적 | 병렬·프로퍼티 테스트에 적합 | "무엇을 할지"와 "실제로 함"이 갈려 코어↔셸 경계가 코드를 부자연스럽게 가름. 에러 위치 역추적 곤란 |
| 데이터 의존 | State/Event가 자기완결적이라 재현 쉬움 | **판정에 필요한 데이터를 전부 미리 로드해야 함**(아래 "핵심 제약") |
| 오버헤드 | 순수 함수 오버헤드는 DB/네트워크 대비 무시 가능 | 부수효과를 값으로 만드는(reify) 타입/디스패처가 필요 → 단순 CRUD엔 과함 |

## 핵심 제약 — 언제 쓰면 안 되는가 (이 레포에 가장 중요한 판정)

**외부 시스템과의 액션이 "도메인 로직의 결과로서" 발생할 때 쓰면 좋고, 외부 액션이 "도메인 로직 안에" 존재하면 쓰면 안 된다.**

이유는 Decider의 설계 불변식 그 자체다. Chassaing 원문:

> "The Event and the State must contain all the data we need, so there is no point fetching data from somewhere else. **No external service calls.** In that structure, mutating data outside would be akin to using global state, which would defeat the purpose of all this."

즉 `decide`가 순수하려면 판정에 필요한 모든 데이터가 **호출 전에** State/Event에 담겨 있어야 한다. 그런데 판정 도중에 "이 값을 알려면 외부 시스템에 물어봐야 한다"가 나오면 — 즉 데이터 위치 자체가 도메인 로직에 달려 있으면 — 순수성이 깨진다.

Chassaing 본인이 이 비판을 인정했다. Dragan Stepanović의 지적을 그대로 인용하며:

> "the downside of the approach is that in cases where the location from where to retrieve the data is dependent on business logic that resides in the domain, execution has to get back from the core to the shell and then back in to the core."

그의 처방("여러 단계로 나눠라")조차 순수성을 부분적으로 포기하는 절충이다. 그리고 적용 조건(Applicability)을 스스로 못 박았다:

> "The Functional Core approach is best suitable ... where the core part will be complex enough ... When infrastructure code is more complex than domain, the functional core approach can still be used **but with few benefits**."

### 판정 규칙 (이 프로젝트의 결론)

```
외부 시스템과의 액션이 도메인 판정 '안에' 있다  → Decider 쓰지 말 것
  예) "재고를 확인해야 취소 가능 여부를 판정할 수 있다" — 판정 도중 외부 조회 필요.
      순수성을 지키려 억지로 미리 다 읽어오는 건 낭비이고, 못 읽어오면 순수성이 깨진다.
      이 경우는 그냥 서비스가 절차적으로 조회-판정-실행하는 게 정직하다.

외부 시스템과의 액션이 도메인 판정의 '결과로서' 발생한다  → Decider가 잘 맞는다
  예) "주문 상태로 취소 가능 여부를 판정 → 그 결과로 PG 취소·포인트 회수·이력 기록을 발생시킨다."
      판정에 필요한 데이터(주문)는 이미 손에 있고, 외부 액션은 판정이 끝난 뒤에 온다.
      decide가 액션 목록을 반환하고 셸이 실행 — 깔끔하게 갈린다.
```

이 구분이 Decider를 "고집할 필요가 없는" 이유다. 데이터 위치가 도메인 로직에 있는 케이스에서는 순수성을 포기하는 게 옳다 — 억지로 Decider에 맞추면 셸↔코어 왕복이나 불필요한 사전 일괄조회를 새로 만든다.

## 왜 admin/user 검증 분기엔 부적합한가

이 문서 시리즈가 다루는 "admin과 user의 검증만 다르다" 문제에 완전한 Decider 정형은 **과하다.**

1. **적용 조건 미충족** — 이 문제의 도메인 복잡도는 "검증 규칙의 다양성"에 있지, 여러 상태 전이를 가진 복잡한 애그리게잇 라이프사이클에 있지 않다. `Event`/`State`/`evolve`/`isTerminal` 전체 정형을 도입할 도메인 복잡도가 아니다.
2. **이벤트소싱이 아니면 이득의 절반이 봉인** — Decider의 "이벤트가 곧 감사기록"은 이벤트 스토어가 있을 때 완전한 값을 낸다. 이벤트를 저장하지 않으면 남는 건 "테스트 용이성" 하나뿐인데, 그거 하나를 위해 액션 타입 계층·디스패처를 만드는 건 reify 오버헤드다.
3. **검증 분기는 이미 [패턴 1](./01-method-split.md)·[패턴 2](./02-policy-injection.md)가 더 싸게 푼다.**

## 취할 수 있는 것 — "판정 순수화"만

단, Decider의 핵심 아이디어인 **"판정을 순수 함수로 뽑기"(FC/IS의 본질)**는 이벤트소싱 없이도, 검증 분기 패턴과 함께 취할 수 있다. Chassaing과 Shore 둘 다 "가장 단순한 버전부터"라며 이 절충을 직접 권장한다.

핵심은 반환을 `Event[]`가 아니라 **얇은 `Verdict`**(승인/거부 + 사유 + 최소 파생값)로 두는 것이다. 이러면 완전성 부담·reify 오버헤드·인터프리터 계층을 전부 피하면서 "판정이 순수 함수라 mock 없이 테스트된다"는 이득만 취한다.

```ts
type CancelVerdict =
  | { ok: false; reason: string }
  | { ok: true; pointsToReverse: number }

// 순수 판정 — Event[]가 아니라 얇은 Verdict. (패턴 1의 메서드 분리와 결합)
function decideCancel(order: Order, actor: 'customer' | 'admin', now: Date): CancelVerdict {
  const allowed = actor === 'admin' ? ADMIN_CANCELLABLE_STATUSES : [OrderStatus.CONFIRMED]
  if (!allowed.includes(order.status)) return { ok: false, reason: 'NOT_CANCELLABLE' }
  return { ok: true, pointsToReverse: order.usedPoints }
}

// 셸 = 기존 서비스. context는 지금도 하던 대로 미리 로드해서 넘긴다.
class OrderCancelService {
  static async cancelByCustomer(orderId: string, userId: string): Promise<void> {
    const order = await OrderRepository.findByUserAndOrderId(userId, orderId)         // 이미 하던 일
    const verdict = decideCancel(order, 'customer', new Date())     // 순수, mock 없이 테스트
    if (!verdict.ok) throw new OrderNotCancellableError(orderId, order.status)
    await this.apply(order, verdict)                               // 기존 실행 그대로
  }
}
```

`context`(order)를 미리 로드하는 건 새 부담이 아니다 — 서비스가 지금도 `OrderRepo.get`으로 하던 일이고, 취소 가능 판정은 order 하나로 끝나서 "판정 도중 추가 조회"라는 함정에 걸리지 않는다(즉 위 "핵심 제약"의 안전한 쪽에 있다). 완전한 Decider는 나중에 order를 이벤트소싱으로 갈 결심이 설 때의 목적지고, 지금 살 필요는 없다.
