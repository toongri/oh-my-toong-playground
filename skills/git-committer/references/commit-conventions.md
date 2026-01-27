# Commit Conventions

## Format

```
<type>: <title>

<body (optional)>
```

## Title Rules

| Rule         | Description                                 |
|--------------|---------------------------------------------|
| Language     | Korean (한국어)                                |
| Max Length   | 50 characters                               |
| Ending Style | Noun-form ending (명사형 종결) - use verbs as nouns (e.g., "추가" add, "수정" fix, "삭제" delete, "구현" implement, "개선" improve) |
| No Period    | Do not end with period                      |

## Types

| Type       | Usage                              | Example                     |
|------------|------------------------------------|-----------------------------|
| `feat`     | New feature                        | feat: 쿠폰 발급 API 추가          |
| `fix`      | Bug fix                            | fix: 포인트 차감 동시성 오류 수정       |
| `refactor` | Code improvement without behavior change | refactor: 주문 검증 로직 서비스로 분리  |
| `docs`     | Documentation                      | docs: API 명세서 엔드포인트 설명 보완   |
| `chore`    | Build, packages, config, etc.      | chore: Spring Boot 버전 업그레이드 |
| `style`    | Formatting, semicolons, etc.       | style: 코드 포맷팅 및 import 정리   |
| `perf`     | Performance improvement            | perf: 상품 조회 쿼리 최적화          |
| `test`     | Test code                          | test: 쿠폰 만료 검증 테스트 추가       |

## Body Rules

| Rule        | Description                                     |
|-------------|-------------------------------------------------|
| When to Add | Only when 'Why' needs explanation               |
| Skip When   | Trivial or self-explanatory changes             |
| Language    | Korean                                          |
| Format      | Bullet points or short paragraphs               |
| Content     | Explain reasoning, not what (title covers what) |
