# API 계약 판단 규칙

컨트롤러 API를 어떻게 구성하고 예외·Null 처리·에러 메시지를 어떻게 다룰지를 다루는 규칙이다. 문서를 열어 판단 기준과 안티패턴을 확인한다.

- `docs/implementation/api-patterns.md` — **컨트롤러 API 구성**: API 관심사를 나누는 이유, ApiSpec 패턴(Swagger 문서화 분리), Query/PageQuery 패턴(페이지네이션 캡슐화), Controller 흐름, 안티패턴
- `docs/implementation/error-handling.md` — **예외·Null·에러 메시지 처리**: 단일 예외 타입을 쓰는 이유, CoreException+ErrorType 패턴, ErrorType Enum, 예외를 던지는 시점별 패턴(Not Found·비즈니스규칙위반·상태전이실패·중복검사), Null Safety(Non-nullable 원칙·`!!` 연산자·안전 호출 연산자), 에러 메시지 규약(컨텍스트 접두사 패턴·메시지 작성 원칙·KDoc), 안티패턴(제네릭 예외·도메인별 예외클래스·컨텍스트 없는 메시지), 이런 생각이 들면 멈춰라(Critical Rules 발췌)
