# 테스트 전략 판단 규칙

테스트 레벨을 무엇으로 잡을지, 레벨별로 무엇을 검증하고 무엇을 안티패턴으로 보는지를 다루는 규칙이다. 문서를 열어 판단 기준을 확인한다.

- `docs/testing/test-levels.md` — **테스트 레벨 선택과 외부 의존성 전략**: 빠른 참조표, 외부 의존성 정의, 레벨 분류 기준, 판단 흐름(Batch 포함), 단순 CRUD 레벨 판단, 애매한 경우 처리, 외부 의존성 처리 원칙, WireMock, Testcontainers, 모킹 범위, 테스트 후 정리, 무엇을 모킹하지 않는가
- `docs/testing/unit-test.md` — **Unit Test 작성**: Unit Test 대상 판단, 파일명·네이밍, 추출 패턴, 상태 전이 테스트 패턴, private 생성자 엔티티 테스트, 예외 타입 관례, ParameterizedTest, 반올림 계산, 정책/전략 패턴, 도메인 이벤트 등록, 품질 체크리스트
- `docs/testing/integration-test.md` — **Integration Test 작성**: Integration Test 대상 판단, 도메인 로직·HTTP 상태·동시성 혼입 안티패턴, 검증 원칙, 추출 패턴, WireMock 외부 API, 롤백 전수 검증, Spring Event 오케스트레이션(AFTER_COMMIT·BEFORE_COMMIT), Kafka Consumer 테스트(성공/실패 안전성·멱등성), 오케스트레이션 성공·트랜잭션 롤백, 파일명·네이밍, 품질 체크리스트
- `docs/testing/concurrency-test.md` — **Concurrency Test 작성**: Concurrency Test 대상 판단, 테스트 구조, `latch.await()` 시점, 스레드 풀 준비, 실행 블록·단언 패턴, 타임아웃 처리, 디버깅, 단일 자원 경합·공유 자원 차감·동시 중복 요청 멱등성, 파일명·네이밍, 품질 체크리스트
- `docs/testing/adapter-test.md` — **Adapter Test 작성**: Adapter Test 대상 판단, `@AfterEach` 리셋, 테스트 셋업, WireMock 헬퍼(stub 패턴), Retry Scenario, Circuit Breaker 상태 전환, Timeout 처리, 에러 응답 파싱, 복잡한 DB 쿼리, 파일명·네이밍, 품질 체크리스트
- `docs/testing/e2e-test.md` — **E2E 테스트 작성**: E2E Test 대상 판단, 파일명·네이밍, 추출 패턴, 테스트 셋업, HTTP 요청 헬퍼, WireMock 스텁 헬퍼, 성공 응답, 비즈니스 규칙 위반(400), Not Found(404), 인증 헤더 누락, 품질 체크리스트
- `docs/testing/batch-test.md` — **Batch 테스트 작성**: Batch Test 핵심 철학, 무엇을 테스트하는가, Batch 컴포넌트의 Unit Test 적용 시점, 파일명·클래스 `@DisplayName`·메서드 네이밍, Processor 로직·프레임워크 컴포넌트 안티패턴, 테스트 격리, Step/Job Integration Test, 품질 체크리스트

**관련 규칙**: 테스트 구조·네이밍·Given/When/Then 작성은 `test-authoring.md` rule에, 스펙에서 케이스를 뽑는 절차와 테스트 데이터 설계는 `test-case-design.md` rule에 있다.
