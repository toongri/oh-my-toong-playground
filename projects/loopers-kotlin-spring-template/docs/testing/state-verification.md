# 상태 검증 규율 — Classical TDD의 Iron Law

테스트가 상태(state)를 검증하는지, 상호작용(interaction)을 검증하는지를 가르는 Iron Law와 그 규칙을 우회하려는 합리화를 방어하는 기준을 담는다.

## 목차

1. **테스트가 존재하는 이유**
2. **Iron Law — 상태만 검증한다**
3. **상태 검증 vs 상호작용 검증**
4. **Red Flags — 이 생각이 들면 멈춘다**
5. **Rationalization Table — 흔한 변명과 반박**
6. **기술적으로 정말 불가능할 때**
7. **자주 하는 실수**

---

## 1. 테스트가 존재하는 이유

테스트는 세 가지 목적을 가진다: 정확성을 검증하고, 동작을 문서화하고, 안전한 리팩토링을 가능하게 한다.

- **실행 가능한 문서로서의 테스트**: 테스트는 항상 최신 상태를 유지하기 때문에 가장 정확한 문서다.
- **두려움 없는 리팩토링을 가능하게 하는 테스트**: 좋은 테스트가 있으면 구현을 안전하게 바꿀 수 있다. 단, 테스트가 구현이 아니라 동작을 검증할 때만 성립한다.
- **설계 문제를 드러내는 테스트**: 테스트를 작성하기 어렵다면, 그건 설계에 대한 피드백이다.

## 2. Iron Law — 상태만 검증한다

```
VERIFY STATE, NEVER INTERACTIONS.
NO EXCEPTIONS. NO NEGOTIATIONS.
```

이 규칙은 **모든** 테스트에 적용된다.

- "단순한 유틸리티는 예외"가 아니다
- "상태 검증이 어려운 경우는 예외"가 아니다
- "팀이 이미 `verify()`를 쓰고 있으니 예외"가 아니다
- "이번 한 번만"도 없다

**이 규칙의 문구(letter)를 어기는 것은 곧 취지(spirit)를 어기는 것이다.**

## 3. 상태 검증 vs 상호작용 검증

이 프로젝트는 **Classical TDD(Detroit School)**를 따른다. 모든 테스트는 **결과(outcome)**를 검증해야 하며, **상호작용(interaction)**을 검증해서는 안 된다.

> 무엇이 일어났는지(WHAT)를 검증하라. 어떻게 일어났는지(HOW)는 검증하지 마라.

### ✅ 허용

```kotlin
assertThat(result).isEqualTo(expected)
assertThat(point.balance).isEqualTo(700L)
assertThatThrownBy { point.use(500L) }.isInstanceOf(CoreException::class.java)
```

### ❌ 금지

```kotlin
verify(repository).save(any())
verify(mock, times(1)).method()
verifyNoInteractions(mock)

// ❌ 이것도 금지: "하이브리드" 접근 — 상태 검증 + verify()
assertThat(order.status).isEqualTo(OrderStatus.PLACED)  // 상태 검증 ✅
verify(paymentClient).requestPayment(any())              // 그런데 verify()까지 ❌ 여전히 금지!
```

**"추가 안전장치"로서의 `verify()`는 없다**: 상태 검증을 이미 했다면 그걸로 끝이다. "안전을 위해" `verify()`를 더하는 것도 금지된다.

## 4. Red Flags — 이 생각이 들면 멈춘다

아래 16가지는 규칙을 어기고 싶어질 때 머릿속에 스치는 합리화다. 이런 생각이 떠오르는 순간 자체가 신호다 — 계속 진행하지 말고 멈춰서 되짚는다.

| 이런 생각이 들면                                                                                     | 실제로는                                                                                    |
|---------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| "이건 BDD 구조를 쓰기엔 너무 단순하다"                                                                  | 단순한 코드일수록 일관된 구조를 쓸 이유가 커진다. 비용이 낮다는 건 변명이 안 된다는 뜻이다.       |
| "외부 서비스에는 `verify()`를 써도 된다"                                                                | WireMock이나 Adapter 테스트를 쓴다. 그것도 불가능하다면 설계에 대한 피드백이다.                  |
| "여기서는 상태 검증이 불가능하다"                                                                       | 검증 가능한 결과를 반환하도록 재설계한다. "테스트하기 어렵다"는 곧 "설계가 나쁘다"는 뜻이다.       |
| "이건 그냥 유틸리티 클래스다"                                                                            | 유틸리티도 BDD 구조가 필요하다. 일관성이 편의보다 우선한다.                                       |
| "이 케이스엔 과하다"                                                                                     | 규칙은 정확히 이렇게 "예외"처럼 느껴지는 순간을 위해 존재한다.                                    |
| "Factory 메서드는 보일러플레이트다"                                                                      | 지금 5분을 들이면 나중의 혼란을 몇 시간 아낀다.                                                   |
| "Service에 도메인 로직이 있으니 Unit Test가 필요하다"                                                    | 도메인 로직은 Domain 모델에 있어야 한다. Service는 오케스트레이션만 한다.                          |
| "Mock을 쓰는 Unit Test가 Integration보다 빠르다"                                                         | 속도가 목표가 아니다. 올바른 테스트 레벨이 목표다.                                                |
| "`verify()`는 그냥 추가 보험일 뿐이다"                                                                   | `verify()` 사용은 어떤 경우든 금지다. "보험"이라는 예외는 없다.                                   |
| "문구가 아니라 취지를 따르는 것이다"                                                                     | 문구를 어기는 것이 곧 취지를 어기는 것이다. 예외는 없다.                                          |
| "정상 케이스 + 실패 케이스 하나면 충분하다"                                                              | 버그는 경계값과 동치 클래스의 끝에 숨는다. 체계적인 커버리지가 필요하다.                            |
| "유효 범위 안의 아무 값이나 써도 된다"                                                                   | 모든 테스트 값은 이름 붙은 동치 클래스를 대표해야 한다. 임의의 값은 곧 검증되지 않은 값이다.        |
| "조합이 너무 많으니 주요 케이스만 테스트한다"                                                            | 어떤 조합을 왜 건너뛰는지 문서화한다. 말없는 누락은 결함이다.                                      |
| "BVA는 숫자 타입에만 적용된다"                                                                            | 경계는 날짜, 문자열 길이, 컬렉션 크기에도 존재한다. BVA는 모든 타입에 적용한다.                     |
| "테스트 값에 주석을 다는 건 과잉 문서화다"                                                               | 값이 대표하는 클래스의 이름을 댈 수 없다면, 왜 그 값을 골랐는지 모르는 것이다.                      |
| "`@CsvSource` 행이 8개를 넘고, 하나의 테스트에서 서로 독립된 2개 이상의 책임을 검증하고 있다"             | Eager Test 안티패턴이다. 책임별로 나눠서 각 테스트가 정확히 하나의 이유로만 실패하게 한다.          |

**이 모든 합리화의 결론은 하나다: 그래도 규칙을 따른다.**

```kotlin
// ❌ "Mock이 더 빠르니까" — 도메인 로직을 Mock으로 감싼 Unit Test, 상호작용만 확인
@Test
fun `use deducts point balance`() {
    val point = mock<Point>()
    whenever(point.balance).thenReturn(700L)
    val result = pointService.use(point, 300L)
    verify(point).use(300L)  // point가 실제로 300을 썼는지, 잔액이 줄었는지는 아무것도 모른다
}

// ✅ 도메인 로직은 Domain 모델의 Unit Test로 — 상태만 검증
@Test
@DisplayName("포인트를 사용하면 잔액이 사용한 만큼 줄어든다")
fun `use reduces balance by the used amount`() {
    // given
    val initialBalance = 1000L
    val point = createPoint(balance = initialBalance)

    // when
    val useAmount = 300L
    point.use(useAmount)

    // then
    assertThat(point.balance).isEqualTo(initialBalance - useAmount)
}
```

## 5. Rationalization Table — 흔한 변명과 반박

§4가 "이런 생각이 들면 멈춰라"는 신호였다면, 아래는 그 생각을 실제 문장으로 옮겼을 때 나오는 13가지 변명과 그 반박이다.

| 변명                                                              | 왜 틀렸는가                                                                        | 대신 할 일                                              |
|---------------------------------------------------------------------|---------------------------------------------------------------------------------------|------------------------------------------------------------|
| "`verify()`가 이걸 테스트하는 유일한 방법이다"                       | WireMock, Testcontainers가 있다. 아니면 재설계한다.                                    | Adapter 테스트 패턴을 쓴다                                  |
| "BDD 구조는 단순한 테스트엔 오버헤드다"                              | 일관성이 체감 효율보다 우선한다                                                         | 어디에나 동일한 구조를 적용한다                              |
| "Factory 메서드는 보일러플레이트다"                                  | 비용이 아니라 투자다                                                                    | 모든 기본값을 채운 Factory를 만든다                          |
| "DRY하게 테스트 간 셋업을 공유한다"                                  | 테스트 격리가 코드 재사용보다 우선한다                                                  | 테스트마다 새 fixture를 만든다                               |
| "상태는 검증했으니 `verify()`는 추가 안전장치다"                     | 어떤 `verify()` 사용도 금지된다. 하이브리드는 없다.                                     | `verify()`를 제거하고 상태만 검증한다                        |
| "Service가 X를 하니 X에 대한 Unit Test가 필요하다"                   | X가 도메인 로직이라면 Domain 모델을 테스트해야 한다                                     | Domain은 Unit Test, Service는 Integration Test              |
| "Mock이 실제 DB보다 빠르다"                                          | 속도보다 정확성이 우선한다. Mock은 실제 버그를 숨긴다.                                  | Integration Test로 실제 DB를 쓴다                            |
| "성공 하나 + 실패 하나면 충분하다"                                   | 성공/실패 경계는 검증되지 않는다                                                        | BVA를 적용한다: 경계-1, 경계, 경계+1                          |
| "ParameterizedTest 값은 설명이 필요 없다"                            | 모든 값은 이름 붙은 클래스를 대표해야 한다                                              | 각 값이 어느 동치 클래스를 대표하는지 주석을 단다              |
| "조합이 너무 많아 현실적이지 않다"                                   | 문서화되지 않은 축소는 숨은 위험이다                                                    | Decision Table을 적용하고 축소 근거를 문서화한다              |
| "BVA는 정수에만 해당한다"                                            | 날짜, 문자열 길이, 가격에도 모두 경계가 있다                                            | 순서가 있는(비교 가능한) 모든 타입에 BVA를 적용한다            |
| "테스트 값 주석은 코드를 지저분하게 한다"                            | 이름 없는 값은 곧 임의의 값이고, 임의의 값은 검증되지 않은 값이다                        | 각 값이 어느 동치 클래스를 대표하는지 주석을 단다              |
| "모든 조합을 한곳에서 검증하는 게 더 빠르다"                         | Eager Test 안티패턴이다. 책임별로 나눠야 각 테스트가 정확히 하나의 이유로만 실패한다      | `@CsvSource`를 책임별로 나눠 관심사당 테스트 하나로 만든다      |

```kotlin
// ❌ "DRY하게 셋업을 공유한다" — 테스트 간 공유되는 mutable 상태
companion object {
    val sharedPoint = Point.of(balance = 1000L)
}

@Test
fun `use reduces balance`() {
    sharedPoint.use(300L)
    assertThat(sharedPoint.balance).isEqualTo(700L)  // 다른 테스트가 먼저 sharedPoint를 건드리면 이 값은 깨진다
}

// ✅ 테스트마다 새 fixture — 실행 순서와 무관하게 항상 같은 결과
@Test
fun `use reduces balance`() {
    // given
    val point = createPoint(balance = 1000L)

    // when
    point.use(300L)

    // then
    assertThat(point.balance).isEqualTo(700L)
}
```

동치 분할(ECP)·경계값 분석(BVA)·Decision Table을 실제로 어떻게 설계하는지는 [test-data-design.md](./test-data-design.md)에서 다룬다. 이 문서는 그 설계 결과를 검증할 때도 상태만 검증해야 한다는 규율만 다룬다.

## 6. 기술적으로 정말 불가능할 때

상태 검증이 기술적으로 불가능해 보인다면 다음 순서를 따른다.

1. **정말 불가능한지 확인한다** — 검증 가능한 상태를 반환하거나 노출하도록 재설계할 수 있는가?
2. **재설계가 가능하다면** — 규칙을 따른다. 먼저 재설계하고, 그다음 테스트한다.
3. **정말 불가능하다면** — 한계를 문서화하고 설계 변경을 제안한다. `verify()`를 우회책으로 쓰지 않는다.

## 7. 자주 하는 실수

아래는 리뷰에서 반복적으로 나오는 8가지 실수다. 대부분 Iron Law(§2)나 상태 검증 원칙(§3)을 구체적인 코드 형태로 어긴 것이다.

| 실수                                    | 왜 틀렸는가                                | 고치는 법                                                  |
|-------------------------------------------|-----------------------------------------------|----------------------------------------------------------------|
| `verify(mock).save(any())`                | 상태가 아니라 상호작용을 검증한다              | 반환되거나 저장된 상태를 assert한다                             |
| 테스트 간 공유되는 mutable 상태            | 테스트 오염, 불안정한(flaky) 결과              | 테스트마다 새 fixture를 만든다                                  |
| 구현 세부사항을 테스트한다                 | 리팩터링하면 깨진다                            | 관찰 가능한 동작만 테스트한다                                   |
| assertion에 매직 넘버를 쓴다               | 무엇을 테스트하는지 불명확하다                 | 이름 붙은 변수를 쓴다: `initialBalance - deductAmount`          |
| 테스트 하나에 여러 동작을 담는다           | 실패 원인을 진단하기 어렵다                    | 테스트당 논리적 assertion 하나                                  |
| `@AfterEach` 정리 누락                    | 테스트 간 DB 오염                              | 생성한 엔티티를 정리한다                                        |
| 순수 위임(pure delegation)에 Unit Test    | Mock이 Mock을 반환할 뿐 — 실제 검증이 아니다   | Unit은 건너뛰고 Integration Test를 작성한다                     |
| 상태 검증 + `verify()` 하이브리드         | 어떤 `verify()`도 금지된다                     | `verify()`를 제거하고 상태 검증만 남긴다                        |

```kotlin
// ❌ 구현 세부사항 + 매직 넘버 — 700이 왜 나왔는지 이 코드만 봐선 알 수 없다
@Test
fun `test1`() {
    val point = createPoint(balance = 1000L)
    point.use(300L)
    assertThat(point.balance).isEqualTo(700L)
}

// ✅ 관찰 가능한 동작 + 이름 붙은 변수 + 논리적 assertion 하나
@Test
@DisplayName("포인트를 사용하면 잔액이 사용한 만큼 줄어든다")
fun `use reduces balance by the used amount`() {
    // given
    val initialBalance = 1000L
    val point = createPoint(balance = initialBalance)

    // when
    val useAmount = 300L
    point.use(useAmount)

    // then
    assertThat(point.balance).isEqualTo(initialBalance - useAmount)
}
```

레벨을 잘못 골라 생기는 실수(예: 순수 위임에 Unit Test)의 판단 기준은 [test-levels.md](./test-levels.md)에서 다룬다.
