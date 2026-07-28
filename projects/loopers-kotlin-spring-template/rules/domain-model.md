# 도메인 모델 판단 규칙

엔티티를 어떻게 캡슐화하고 도메인 이벤트를 어떻게 정의·리스닝할지를 다루는 규칙이다. 문서를 열어 판단 기준과 안티패턴을 확인한다.

- `docs/implementation/entity-patterns.md` — **JPA 엔티티 캡슐화**: 리치 도메인 모델이 필수인 이유, 캡슐화 규칙(상속 구조 BaseEntity·인덱스 설계 @Table·기본값 가시성 private set·행위 메서드·불변 값객체·생성자/팩토리 검증·상태변경-이벤트발행 연계), 안티패턴(빈약한 도메인모델·BaseEntity 없는 엔티티·private set 없는 var·인덱스 없는 @Table·엔티티 밖 상태변경·도메인의 @JsonProperty·도메인의 JPA Repository 직접주입), 이 규칙들이 중요한 이유, 이런 생각이 들면 멈춰라(Critical Rules 발췌)
- `docs/implementation/domain-events.md` — **도메인 이벤트 정의와 EventListener**: 버전과 스냅샷이 필요한 이유, 도메인 이벤트 정의(네이밍 버전접미사·구조 요구사항), EventListener 트랜잭션 단계(BEFORE_COMMIT/AFTER_COMMIT·@TransactionalEventListener·AFTER_COMMIT 쓰기의 REQUIRES_NEW), 크로스도메인 통신(Facade vs 이벤트), 안티패턴(이벤트 구조·EventListener), Red Flags, 이런 생각이 들면 멈춰라(Critical Rules 발췌)
