# 레이어 배치 판단 규칙

Controller·Service·Facade·도메인 사이에 로직을 어디 두고, DTO와 캐시를 레이어 사이에 어떻게 흘릴지를 다루는 규칙이다. 문서를 열어 판단 기준과 안티패턴을 확인한다.

- `docs/implementation/layer-boundaries.md` — **레이어 사이 책임과 의존 방향**: 레이어 선택 빠른 판단표, 레이어 설계 원칙, 레이어 의존 방향, Controller-Facade 호출관계, Service/Facade 책임분담(단일도메인 vs 도메인간조율), 트랜잭션 경계(@Transactional 위치), 이벤트 리스너 위치, 안티패턴(Service-Service 수평의존·Facade-Facade 의존·Facade 비즈니스로직·EventListener 비즈니스로직·도메인의 Infrastructure Import), 도메인 순수성, 의존성 검사 방법, 이런 생각이 들면 멈춰라(Critical Rules 발췌)
- `docs/implementation/dto-patterns.md` — **Request에서 Response까지 DTO 흐름**: 레이어마다 DTO를 두는 이유, 레이어별 DTO 구조, Request/Criteria/Command/Info/Response DTO, Controller Flow, 안티패턴(Entity 직접노출·레이어 건너뛰기·변환메서드 네이밍·단일클래스 DTO), 이런 생각이 들면 멈춰라(Critical Rules 발췌)
- `docs/implementation/caching-patterns.md` — **캐싱 적용 위치와 무효화 전략**: 캐싱 핵심 규칙, 레이어 책임, Cache-Aside 패턴(Facade), 캐시 키(sealed class), 캐시 모델(버전 DTO), List+Detail 다단계 캐싱, 캐시 무효화(Kafka Consumer·@TransactionalEventListener), 사전 집계 캐시(배치 잡), 금지·안티패턴, 이런 생각이 들면 멈춰라(Critical Rules 발췌)
