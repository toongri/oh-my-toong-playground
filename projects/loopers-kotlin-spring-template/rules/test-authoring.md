# 테스트 작성 규율 판단 규칙

테스트를 어떤 구조·네이밍·검증 방식으로 작성할지를 다루는 규칙이다. 문서를 열어 판단 기준을 확인한다.

- `docs/testing/state-verification.md` — **상태 검증 원칙(Classical TDD Iron Law)**: 테스트가 존재하는 이유, Iron Law, 상태 검증 vs 상호작용 검증, Red Flags, Rationalization Table, 기술적으로 불가능한 경우의 예외, 자주 하는 실수
- `docs/testing/test-authoring.md` — **테스트 작성 구조(BDD·네이밍·Factory Method)**: `@Nested` 클래스 구성, 네이밍 컨벤션(예외 테스트·메서드명 패턴), Given/When/Then 작성, Factory Method 패턴, 필요한 것만 노출, 단일 논리적 assertion, 의미 있는 변수명, 테스트 격리, 한 테스트·한 행동, 테스트 파일 스코핑, 생성 품질 체크리스트

**관련 규칙**: 레벨별로 무엇을 검증할지는 `test-strategy.md` rule에, 스펙에서 테스트 케이스를 뽑는 절차와 테스트 데이터 설계는 `test-case-design.md` rule에 있다.
