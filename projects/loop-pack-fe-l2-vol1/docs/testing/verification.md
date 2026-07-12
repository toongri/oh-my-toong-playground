# 테스트 검증 · 품질 측정

테스트를 작성하는 것과, 그 테스트 스위트가 실제로 품질을 지키는지 확인하는 것은 다른 문제다. 이 문서는 테스트 작성 다음 단계 — 커버리지·비주얼·접근성·flaky·뮤테이션·계약 테스트·정적 게이트 — 를 다룬다. 테스트 작성 관용구는 [conventions.md](./conventions.md), 도구 선택은 [tooling.md](./tooling.md)에 있다.

## 관통 원칙: 지표가 목표가 되는 순간 측정을 멈춘다

모든 품질 지표는 목표로 거는 순간 품질 측정 기능을 잃는다. 커버리지 %를 팀 목표로 걸면 assertion 없는 테스트로 라인만 채우는 유인이 생기고, mutation score를 게이트로 걸면 mutant를 잡는 테스트가 아니라 score를 위한 테스트가 생긴다. 아래 지표를 읽을 때 이 원칙을 기준으로 삼는다.

## 커버리지: 신호지 목표가 아니다

커버리지는 실행된 라인의 비율이지 assertion의 품질을 재지 않는다 — `expect` 없는 테스트도 라인 커버리지 100%를 만들 수 있다. 70%를 넘긴 다음부터는 라인을 추가할수록 수확체감이 커지고, 모든 라인을 동일 가중치로 취급해 위험한 분기와 사소한 getter가 같은 값을 갖는다(https://kentcdodds.com/blog/how-to-know-what-to-test).

실무 기준은 line 커버리지보다 **branch 커버리지**를 본다 — 조건문의 양쪽 분기가 실제로 실행됐는지가 라인 실행 여부보다 위험을 더 잘 드러낸다. 레이어별로 기대하는 커버리지 깊이가 다르므로 레이어 정의는 [test-layers.md](./test-layers.md)를 참고한다. threshold는 절대 목표가 아니라 **ratchet**(현재 값 아래로 떨어뜨리지 않는 하한)으로 운용한다.

## 비주얼 회귀: Playwright 기본, 필요할 때만 유상 서비스

픽셀 단위 UI 회귀는 Playwright의 `toHaveScreenshot()`으로 무료로 잡는다. 단, 폰트 렌더링과 OS별 안티앨리어싱 차이 때문에 로컬에서 만든 baseline은 CI 컨테이너에서 어긋난다 — **baseline은 CI와 동일한 컨테이너 환경에서 생성**해야 한다(https://playwright.dev/docs/test-snapshots).

팀 규모가 커져 리뷰가 병목이 되면 Chromatic/Percy 같은 유상 서비스로 넘어갈 수 있다(속도·자동화 개선치는 각 벤더가 자체 보고한 수치이므로 그대로 믿지 않는다). 로직 위주 앱처럼 시각 요소가 부수적인 경우는 비주얼 회귀 자체를 스킵해도 된다.

## 접근성 자동화: 서로 다른 두 수치

접근성 자동화는 흔히 잘못 인용되는 영역이다. 다음 두 수치를 구분한다.

- **이슈 볼륨 기준 약 57%** — 실제 발견되는 접근성 이슈 전체 중 자동화 도구가 잡아내는 비율(Deque 연구, https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/).
- **WCAG 기준 자체로는 약 30~40%** — 머신이 기계적으로 판정 가능한 WCAG 기준의 비율.

둘 다 사실이지만 서로 다른 질문에 대한 답이다. axe-core/jest-axe는 **바닥선이지 천장이 아니다** — 키보드 탐색 순서, 포커스 관리, 스크린리더가 실제로 읽는 의미는 사람이 확인해야 한다.

## flaky 테스트: 마취지 치료가 아니다

flaky 테스트 원인의 약 45%는 비동기·타이밍 문제다(대기 없는 assertion, race condition 등). `retries: process.env.CI ? 2 : 0`처럼 CI에서만 재시도를 허용하고 로컬은 0으로 둔다 — 로컬에서 retry로 통과시키면 원인을 못 보고 지나친다(https://playwright.dev/docs/test-retries).

retry 끝에 통과한 테스트는 **flaky로 표시하고 버그 티켓을 만든다.** 삭제하지 않고 quarantine(별도 스위트로 격리해 메인 게이트에서 제외)한다 — 삭제하면 그 테스트가 지키던 회귀 방어를 영구히 잃는다.

## 뮤테이션 테스트: 테스트를 테스트한다

뮤테이션 테스트(대표 도구: StrykerJS)는 소스 코드에 결함을 주입한 뒤(예: `>`를 `>=`로 변경), 기존 테스트 스위트가 그 변경을 잡아내는지(killed) 확인한다. assertion 없는 테스트는 라인 커버리지 100%를 만들면서도 mutant kill 수는 0일 수 있다 — 커버리지가 못 잡는 맹점을 여기서 잡는다(https://stryker-mutator.io/).

실행 비용이 크므로 매 PR 게이트가 아니라 **nightly 또는 변경 범위가 큰 핵심 모듈에만** 타겟팅해 돌린다.

## 계약 테스트(Pact): 존재만 알아둔다

계약 테스트는 프론트엔드와 백엔드가 **서로 다른 배포 주기로 독립 배포될 때** 인터페이스가 어긋나지 않는지 검증한다(https://docs.pact.io/). 모노레포에서 프론트와 백엔드가 원자적으로 함께 배포되면 이 역할은 OpenAPI/tRPC/GraphQL 코드젠이 만드는 타입체크로 충분히 커버된다. 이 문서가 다루는 중급 프론트엔드 실무 수준 — 기본기를 넘어 판단 기준까지 익히는 단계 — 에서는 계약 테스트가 존재한다는 것만 알아두면 된다.

## 가장 싼 상시 방어선: 정적 게이트

`tsc --noEmit`과 ESLint는 테스트 스위트를 실행하기도 전에 가장 싸게 결함을 잡는다. 특히 `eslint-plugin-testing-library`와 `eslint-plugin-jest-dom`(https://github.com/testing-library/eslint-plugin-testing-library)은 [conventions.md의 안티패턴 표](./conventions.md#ai-단골-안티패턴)에 있는 실수(`container.querySelector`, 부적절한 matcher 등)를 테스트 작성 시점에 자동으로 막는다.

CI 파이프라인은 **정적 게이트(fast-fail) → affected 테스트 → 샤딩 → 머지 게이트** 순서로 짠다. 스위트가 1분 안에 끝난다면 샤딩은 조기 최적화다 — 오케스트레이션 오버헤드가 실행 시간 절감보다 커진다.
