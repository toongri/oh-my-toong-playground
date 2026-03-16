# Commit Conventions

## Format

```
<type>: <subject>
                       ← blank line (required if body exists)
<body (optional)>
                       ← blank line (required if footer exists)
<footer (optional)>
```

**Three parts:** Subject (required), Body (optional), Footer (optional)

## Subject Rules

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
| Blank Line  | **Required** blank line between subject and body |
| Language    | Korean                                          |
| Line Length | Wrap at 72 characters                           |
| Format      | Bullet points or short paragraphs               |
| Content     | Explain reasoning, not what (subject covers what) |

## Footer Rules

| Rule        | Description                                     |
|-------------|-------------------------------------------------|
| When to Add | Breaking changes, issue refs, co-authors        |
| Blank Line  | **Required** blank line between body and footer |
| Language    | Token names in English (git standard), descriptions in Korean |
| Format      | `token: value` or `token #value`                |

### Footer Tokens

| Token | Format | Example |
|-------|--------|---------|
| `BREAKING CHANGE` | `BREAKING CHANGE: 설명` (Korean) | `BREAKING CHANGE: API 응답 형식 변경` |
| Issue reference | `Fixes #number` | `Fixes #42` |
| Multiple issues | One per line | `Fixes #42`<br>`Fixes #43` |
| Co-author | `Co-authored-by: Name <email>` | `Co-authored-by: 김민수 <minsu@example.com>` |

**Co-author notes:**
- Email is required (git standard)
- If unknown, use `Co-authored-by: Name <name@users.noreply.github.com>`

### Footer Order (when multiple)

```
BREAKING CHANGE: 설명
                       ← blank line after BREAKING CHANGE
Fixes #42
Co-authored-by: 김민수 <minsu@example.com>
```

## Complete Example

```
feat!: 결제 서비스에 Strategy 패턴 적용

기존 PaymentProcessor의 결합도가 높아 새로운 결제 수단 추가가
어려웠음. Strategy 패턴으로 결제 로직 분리하여 확장성 확보.

BREAKING CHANGE: PaymentProcessor가 PaymentStrategy로 대체

Fixes #42
Co-authored-by: 김민수 <minsu@example.com>
```
