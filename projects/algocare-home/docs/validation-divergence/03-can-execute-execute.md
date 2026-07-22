# 패턴 3 — CanExecute / Execute

> "자격 획득 여부 확인"과 "실제 실행"을 별도 public 메서드로 나누는 패턴. [패턴 1](./01-method-split.md)·[패턴 2](./02-policy-injection.md)와 **직교**하며, 그 위에 얹는다.

출처: Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* 7장 "Using the CanExecute/Execute pattern", 그리고 "Validation and DDD"(enterprisecraftsmanship.com, 2016-09-13).

## 한 줄 요약

하지 않고 **물어볼 수 있는** 질의(`canExecute`)와 실제로 **하는** 명령(`execute`)을 나눈다. 질의는 에러를 예외가 아니라 **데이터(목록)**로 돌려주고, 명령은 내부에서 그 질의를 다시 불러 가드한 뒤 상태를 바꾼다. 검증 규칙은 질의 한 곳에만 살고, UI와 실행이 그것을 공유한다.

## 언제

- **프런트가 "이 버튼을 켤까 / 왜 못 켜나"를 미리 알아야 할 때.** 취소 버튼을 회색으로 비활성화하고 사유를 툴팁에 띄우려면 "실행 안 하고" 물어봐야 한다.
- **여러 검증 에러를 한꺼번에 사용자에게 보여줘야 할 때.** `throw`는 첫 에러에서 멈추지만 질의는 목록이라 "결제상태 아님 + 기간 지남"을 동시에 반환한다.
- 이 두 요구가 **없으면 얹지 않는다.** 그냥 `cancelByCustomer(): void`가 던지면 끝이다. Can을 얹는 건 오버엔지니어링이다.

## 왜 "Can"이 붙나

`canCancel...`은 **실행하지 않고 물어볼 수 있는 질문**이라서다. 실행하지 않고 "지금 되나?"의 답을 값으로 돌려준다. 네이밍 규약 자체가 성질을 드러낸다 — `can/is/has`로 시작하면 **질의**(예/아니오·에러 목록을 값으로), 동사로 시작하면 **명령**(상태를 바꿈). `canCancel`은 물음표, `cancel`은 마침표다.

Khorikov가 이 패턴으로 `IsValid` 방식을 대체한 논거: "스스로 유효한지 검사하려면 객체가 먼저 무효 상태에 들어가야 한다"(*"In order to validate itself, the entity must enter an invalid state first. And that means the aggregate no longer maintains its consistency boundary."*). 그래서 `canCancel`은 **제안된 입력을 인자로 받아** "이렇게 하면 유효할까?"를 상태를 더럽히지 않고 답한다.

## 어떻게 — 예시

### 기본형 (도메인 객체 안)

```ts
class Order {
  // "할 수 있나?" — 순수 질의. 부수효과 0, throw 안 함, 상태 안 바꿈.
  //  에러를 '예외'가 아니라 '데이터(목록)'로 돌려준다. 빈 배열 = 가능.
  canCancelByCustomer(now: Date): string[] {
    const errors: string[] = []
    if (this.status !== OrderStatus.CONFIRMED)
      errors.push('결제완료 상태에서만 취소할 수 있습니다')
    if (this.isPastReturnWindow(now))
      errors.push('취소 가능 기간이 지났습니다')
    return errors
  }

  // "한다" — 명령. 내부에서 먼저 can을 확인(가드)하고, 그다음 상태를 바꾼다.
  cancelByCustomer(now: Date): void {
    if (this.canCancelByCustomer(now).length > 0)
      throw new InvalidOperationException()   // 가드를 건너뛴 프로그래밍 실수일 때만 발생
    this.status = OrderStatus.CANCELLED
  }
}
```

위 `cancelByCustomer`는 **자기 상태 전이만** 한다. 결제 취소·포인트 환급 같은 크로스도메인 집행은 이 도메인 명령을 부른 뒤 **서비스 셸이 오케스트레이션**한다 — 패턴 1·2의 `execute`와 같은 자리다. 즉 "가드 + 전이"는 도메인, "집행"은 서비스로 갈리고, can/execute 분리(질의-명령 축)는 그 위에 직교로 얹힌다.

### 프런트가 질의를 소비 (드리프트 차단의 핵심)

```ts
// 백엔드: 질의를 그대로 노출하는 read 엔드포인트
cancelability: userProcedure
  .input(z.object({ orderId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const order = await OrderRepository.findByUserAndOrderId(ctx.user.id, input.orderId)
    const errors = order.canCancelByCustomer(new Date())
    return { cancellable: errors.length === 0, reasons: errors }
  })
```

```tsx
// 프런트: 같은 규칙으로 버튼과 사유를 렌더
const { data } = trpc.order.cancelability.useQuery({ orderId })
<Button disabled={!data?.cancellable} title={data?.reasons.join('\n')}>취소</Button>
```

프런트의 "버튼 활성 판정"과 백엔드의 "취소 실행 가드"가 **같은 `canCancelByCustomer` 함수**를 소비하므로, "클라 게이트와 서버 게이트가 어긋남"이라는 흔한 드리프트가 원천 차단된다.

### 패턴 1·2와 결합

CanExecute/Execute는 검증 분기 축(패턴 1·2)과 **직교**한다. actor별로 질의를 나누면 패턴 1과 합쳐진다.

```ts
class Order {
  canCancelByCustomer(now: Date): string[] { /* 고객 정책 */ }
  canCancelByAdmin():          string[] { /* admin 정책 */ }

  cancelByCustomer(now: Date): void { if (this.canCancelByCustomer(now).length) throw ...; /* 실행 */ }
  cancelByAdmin(reason: string): void { if (this.canCancelByAdmin().length) throw ...; /* 실행 */ }
}
```

## 장단점

| | |
|---|---|
| **장점** | "안 하고 물어보기"가 가능 → UI 버튼/사유 제어. 에러를 목록으로 한꺼번에 반환. 검증 규칙이 질의 한 곳에만 살고 UI·실행이 공유 → 클라/서버 검증 드리프트 차단. |
| **단점** | **검증을 두 번 돈다**(Khorikov 본인 인정: *"Of course, we're now running the precondition check twice."*). UI 사전판정 요구가 없으면 순수 오버헤드. 질의와 명령을 함께 유지해야 하는 관리 부담. |

## 다른 패턴과의 정확한 경계

### vs 패턴 1·2 (직교)

패턴 1·2는 "**검증이 actor마다 다른 걸 어떻게 표현하나**"(분기 축)를 답한다. CanExecute/Execute는 "**한 연산에서 물어보기를 하기에서 가르나**"(질의-명령 축)를 답한다. 서로 다른 질문이라 조합된다 — 위 "패턴 1·2와 결합" 예시 참조.

### vs [패턴 4 Decider](./04-decider.md) (헷갈리기 쉬움)

둘 다 "판정과 실행 분리"처럼 보이지만 **분리의 위치가 다르다.**

- **CanExecute/Execute** — 검증과 실행이 **같은 객체·같은 호출 안**에 있고, 실행은 여전히 그 객체가 한다. `cancelByCustomer`가 내부에서 `canCancelByCustomer`를 재검증하고 자기 상태를 바꾼다. 값을 "나중에 실행할 무언가"로 반환하지 않는다. → **최소 침습 캡슐화**(도메인 객체가 스스로 불변식을 지키게 함).
- **Decider** — `decide`는 상태를 안 바꾸고 아무것도 실행 안 한다. 반환된 이벤트/액션을 완전히 별도의 실행기가 소비한다. 코어는 실행 능력 자체가 없다. → **최대 침습 아키텍처**(실행을 통째로 외부화).
