# Pin Examples by SSOT Kind

24 worked examples (8 SSOT kinds × 2 good + 1 bad). Each pin contains the v1 frontmatter schema (7 required fields) and the 4-section body format (AC-18). Bad examples include an explanation of the violation.

Pin body sections are rendered as bold headings inside examples to avoid H3 boundary collision with the per-kind awk range verifier (AC-20).

> **참고**: 본 파일의 예시들은 `pin-up` Stop hook이 직렬화한 결과 형식이다. AI가 emit하는 형식은 SKILL.md의 `<pin>` XML이며, 본 예시의 frontmatter는 직렬화 결과로 생성된다 — 학습 시 frontmatter 그대로 emit하지 않고 `<pin>` XML 형식을 사용한다.

---

### code

#### 좋은 예 1

```
---
slug: code-auth-jwt-verify
source_url: https://github.com/example/repo/blob/main/src/auth/jwt.ts#L142
authority: src/auth/jwt.ts (코드베이스 정의)
tier: 1
tags: "auth,jwt,verification"
sensitivity: private
created_at: 2026-04-29T10:15:00+09:00
---
```

**① 한 줄 요지**
JWT 검증의 실질 진입점은 `verifyToken()`(jwt.ts:142)이며, 만료 체크와 서명 검증을 모두 담당한다.

**② SSOT 위치**
`src/auth/jwt.ts` L142 — `export function verifyToken(token: string): Payload`
GitHub permalink: https://github.com/example/repo/blob/main/src/auth/jwt.ts#L142

**③ 전후 컨텍스트**
로그인 플로우 디버깅 중 토큰이 만료돼도 통과되는 버그를 추적하다 발견. `verifyToken`이 `exp` 클레임을 건너뛰는 코드 경로가 있었음.

**④ 관련 cross-link**
- 관련: `code-auth-middleware-guard` (이 함수를 호출하는 미들웨어)
- SSOT URL: https://github.com/example/repo/blob/main/src/auth/jwt.ts#L142

---

#### 좋은 예 2

```
---
slug: code-billing-stripe-webhook
source_url: https://github.com/example/repo/blob/main/src/billing/webhook.ts#L87
authority: src/billing/webhook.ts (결제 처리 코드)
tier: 2
tags: "billing,stripe,webhook,idempotency"
sensitivity: private
created_at: 2026-04-29T11:30:00+09:00
discovery_context: Stripe 이중 결제 사고 조사 중 발견
---
```

**① 한 줄 요지**
Stripe webhook 멱등성 키 처리는 `webhook.ts:87`의 `handleEvent()`에서 하며, DB 중복 체크가 선행된다.

**② SSOT 위치**
`src/billing/webhook.ts` L87 — `async function handleEvent(event: Stripe.Event)`
GitHub permalink: https://github.com/example/repo/blob/main/src/billing/webhook.ts#L87

**③ 전후 컨텍스트**
이중 결제 사고 포스트모템에서 webhook 핸들러의 멱등성 보장 여부를 확인하다 발견. L87~L103에서 `event.id`를 PK로 upsert하여 중복 방지.

**④ 관련 cross-link**
- 관련: `notion-billing-stripe-contract` (Stripe 계약 문서 pin)
- SSOT URL: https://github.com/example/repo/blob/main/src/billing/webhook.ts#L87

---

#### 나쁜 예 1

```
---
slug: code-auth-how-jwt-works
source_url: https://github.com/example/repo/blob/main/src/auth/jwt.ts
authority: 팀 인지
tier: 2
tags: "auth,jwt"
sensitivity: private
created_at: 2026-04-29T10:00:00+09:00
---
```

**① 한 줄 요지**
JWT는 헤더.페이로드.서명 3부분으로 구성된 토큰이다.

**② SSOT 위치**
src/auth/jwt.ts 전체

**③ 전후 컨텍스트**
JWT 공부 중 정리함.

**④ 관련 cross-link**
없음

**위반 이유**: (1) slug `code-auth-how-jwt-works`에 동사형 `how`가 포함돼 slug 원칙 ⑥(동사/형용사 금지)를 위반한다. (2) 본문이 일반 JWT 지식(어디서나 검색 가능)을 위키 형식으로 설명하며 SSOT 본문을 복사하는 anti-pattern(`ssot-no-copy`)에 해당한다. pin은 인덱스이지 백과사전이 아니다.

---

### github-pr

#### 좋은 예 1

```
---
slug: github-pr-oauth-scope-fix
source_url: https://github.com/example/repo/pull/482
authority: PR #482 (리뷰어: KS, merged)
tier: 1
tags: "auth,oauth,scope,bugfix"
sensitivity: private
created_at: 2026-04-29T14:00:00+09:00
---
```

**① 한 줄 요지**
OAuth scope 누락 버그(로그인 후 캘린더 권한 없음)는 PR #482에서 `offline_access` scope 추가로 수정됐다.

**② SSOT 위치**
GitHub PR #482: https://github.com/example/repo/pull/482
브랜치: `fix/oauth-offline-scope`, merged 2026-03-15

**③ 전후 컨텍스트**
캘린더 연동 QA 중 `refresh_token`이 발급되지 않는 문제를 추적하다 발견. `offline_access` scope가 빠진 것이 원인이었고 PR에서 scope 목록이 확정됨.

**④ 관련 cross-link**
- 관련: `code-auth-oauth-client` (OAuth 클라이언트 구현 위치)
- 이슈: https://github.com/example/repo/issues/477

---

#### 좋은 예 2

```
---
slug: github-pr-db-migration-rollback
source_url: https://github.com/example/repo/pull/531
authority: PR #531 (리뷰어: JH, DB 담당)
tier: 1
tags: "database,migration,rollback,postgres"
sensitivity: private
created_at: 2026-04-29T15:20:00+09:00
discovery_context: 스테이징 배포 장애 복구 작업 중 확인
---
```

**① 한 줄 요지**
컬럼 삭제 마이그레이션은 반드시 2-phase PR(컬럼 unused 표시 → 삭제)로 진행해야 한다 — PR #531에서 결정.

**② SSOT 위치**
GitHub PR #531: https://github.com/example/repo/pull/531
PR 본문 "Migration Strategy" 섹션에 2-phase 규칙이 문서화됨.

**③ 전후 컨텍스트**
스테이징에서 단일 PR로 컬럼을 삭제했을 때 배포 중 앱이 크래시. 롤백 작업 중 JH가 2-phase 절차를 PR에 기술하고 팀 규칙으로 확정.

**④ 관련 cross-link**
- 관련: `notion-db-migration-runbook` (마이그레이션 런북 문서)
- SSOT URL: https://github.com/example/repo/pull/531

---

#### 나쁜 예 1

```
---
slug: github-pr-recent-oauth-changes
source_url: https://github.com/example/repo/pull/482
authority: 팀
tier: 2
tags: "oauth"
sensitivity: private
created_at: 2026-04-29T14:00:00+09:00
---
```

**① 한 줄 요지**
최근 OAuth 관련 PR이 있었다.

**② SSOT 위치**
PR #482

**③ 전후 컨텍스트**
최근 변경사항 정리.

**④ 관련 cross-link**
없음

**위반 이유**: slug `github-pr-recent-oauth-changes`에 시간제한사 `recent`가 포함돼 slug 원칙 ⑦(시간제한사 금지)를 위반한다. 6개월 후 "recent"는 의미를 잃는다. 또한 한 줄 요지가 내용 없이 모호하여 pin의 핵심 가치인 즉각적 지식 전달에 실패한다.

---

### github-issue

#### 좋은 예 1

```
---
slug: github-issue-ratelimit-decision
source_url: https://github.com/example/repo/issues/390
authority: Issue #390 (PM: SY, Eng: KS — 결정권자 명시)
tier: 1
tags: "api,ratelimit,decision,architecture"
sensitivity: private
created_at: 2026-04-29T09:00:00+09:00
---
```

**① 한 줄 요지**
API rate limit 정책(1000 req/min/user)은 Issue #390에서 확정됐으며 PM SY와 Eng KS가 결정권자다.

**② SSOT 위치**
GitHub Issue #390: https://github.com/example/repo/issues/390
Comment #12 — 최종 결정 스레드

**③ 전후 컨텍스트**
외부 파트너 연동 작업 중 rate limit 기준이 불명확해서 이슈 추적. KS가 Comment #12에서 1000 req/min을 확정하고 인프라 설정과 API 문서 반영을 지시.

**④ 관련 cross-link**
- 관련: `code-api-ratelimit-middleware` (실제 미들웨어 구현 위치)
- 관련: `notion-api-partner-guide` (파트너 가이드 문서)

---

#### 좋은 예 2

```
---
slug: github-issue-search-index-lag
source_url: https://github.com/example/repo/issues/415
authority: Issue #415 (담당: TG, Elasticsearch 담당자)
tier: 2
tags: "search,elasticsearch,lag,known-issue"
sensitivity: private
created_at: 2026-04-29T16:45:00+09:00
discovery_context: 검색 기능 디버깅 중 기존 이슈 발견
---
```

**① 한 줄 요지**
Elasticsearch 인덱스 지연(최대 30초)은 Known issue #415로 v2 마일스톤에서 수정 예정이다.

**② SSOT 위치**
GitHub Issue #415: https://github.com/example/repo/issues/415
마일스톤: v2.0, 담당: TG

**③ 전후 컨텍스트**
새 글 작성 직후 검색에서 안 나온다는 버그 리포트를 받고 디버깅하다 기존 이슈 발견. Elasticsearch bulk index 타이밍 문제로 이미 추적 중. v2에서 real-time indexing으로 전환 예정.

**④ 관련 cross-link**
- 관련: `code-search-indexer-bulk` (인덱서 구현 위치)
- SSOT URL: https://github.com/example/repo/issues/415

---

#### 나쁜 예 1

```
---
slug: github-issue-ratelimit-decision
source_url: https://github.com/example/repo/issues/390
authority: GitHub Issue
tier: 2
tags: "ratelimit"
sensitivity: private
created_at: 2026-04-29T09:00:00+09:00
---
```

**① 한 줄 요지**
Rate limit에 관한 이슈가 있다.

**② SSOT 위치**
Issue #390

**③ 전후 컨텍스트**
이슈 내용:

Rate limit을 1000 req/min으로 설정하기로 결정했다. 이유는 서버 부하 테스트 결과 1000이 안전한 상한이었기 때문이다. 구현은 Redis 기반 슬라이딩 윈도우를 사용하며... (이하 이슈 본문 전체 복사)

**④ 관련 cross-link**
없음

**위반 이유**: `③ 전후 컨텍스트` 섹션에 이슈 본문을 그대로 복사하는 `ssot-no-copy` anti-pattern을 범했다. pin은 SSOT를 가리키는 포인터이지, SSOT를 복제하는 공간이 아니다. 본문이 길어질수록 "잘못된 SSOT"(`long-body-wrong-ssot`)가 된다.

---

### github-wiki

#### 좋은 예 1

```
---
slug: github-wiki-deployment-checklist
source_url: https://github.com/example/repo/wiki/Deployment-Checklist
authority: GitHub Wiki (유지보수: DevOps TG)
tier: 1
tags: "deployment,checklist,devops,runbook"
sensitivity: private
created_at: 2026-04-29T13:00:00+09:00
---
```

**① 한 줄 요지**
프로덕션 배포 체크리스트(DB 마이그레이션 → 스테이징 smoke → 슬랙 공지)의 권위는 GitHub Wiki Deployment-Checklist 페이지다.

**② SSOT 위치**
GitHub Wiki: https://github.com/example/repo/wiki/Deployment-Checklist
최종 갱신: 2026-03-20 (TG)

**③ 전후 컨텍스트**
배포 절차를 물어봤다가 팀 내 인식 불일치를 발견. TG가 Wiki를 정식 절차로 지정했음. 이후 배포 전 반드시 Wiki 확인.

**④ 관련 cross-link**
- 관련: `github-pr-db-migration-rollback` (마이그레이션 주의사항 PR)
- SSOT URL: https://github.com/example/repo/wiki/Deployment-Checklist

---

#### 좋은 예 2

```
---
slug: github-wiki-api-versioning
source_url: https://github.com/example/repo/wiki/API-Versioning-Policy
authority: GitHub Wiki (정책 결정: PM SY + Lead KS)
tier: 1
tags: "api,versioning,policy,breaking-change"
sensitivity: private
created_at: 2026-04-29T14:30:00+09:00
discovery_context: 파트너 연동 브레이킹 체인지 검토 중
---
```

**① 한 줄 요지**
API 버전 정책(Major 브레이킹 체인지는 6개월 deprecated 기간 필수)의 권위는 Wiki API-Versioning-Policy다.

**② SSOT 위치**
GitHub Wiki: https://github.com/example/repo/wiki/API-Versioning-Policy
"Deprecation Timeline" 섹션이 핵심.

**③ 전후 컨텍스트**
파트너사 B가 API v1 엔드포인트 삭제 일정을 물어봤고, 내부 정책 기준을 확인하러 찾음. 6개월 deprecated 기간 규칙이 Wiki에 있었고 이것이 최종 기준.

**④ 관련 cross-link**
- 관련: `github-issue-ratelimit-decision` (rate limit 정책 이슈)
- SSOT URL: https://github.com/example/repo/wiki/API-Versioning-Policy

---

#### 나쁜 예 1

```
---
slug: github-wiki-deployment-checklist
source_url: https://github.com/example/repo/wiki/Deployment-Checklist
authority: GitHub Wiki
tier: 1
tags: "deployment"
sensitivity: private
created_at: 2026-04-29T13:00:00+09:00
---
```

**① 한 줄 요지**
배포 체크리스트

**② SSOT 위치**
GitHub Wiki Deployment-Checklist 페이지

**③ 전후 컨텍스트**
배포 체크리스트 내용:
1. DB 마이그레이션 실행
2. 스테이징 smoke test
3. 슬랙 공지 (#deploy 채널)
4. 프로덕션 배포
5. 모니터링 30분 대기
(체크리스트 항목 전체 복사)

**④ 관련 cross-link**
없음

**위반 이유**: Wiki 체크리스트 항목 전체를 pin 본문에 복사했다 — 전형적인 wiki anti-pattern이자 `ssot-no-copy` 위반이다. Wiki가 갱신돼도 pin 본문은 stale해지고, pin과 Wiki 간 두 가지 진실이 생긴다. pin은 "체크리스트 권위가 Wiki에 있다"는 사실만 가리켜야 한다.

---

### linear

#### 좋은 예 1

```
---
slug: linear-notifications-push-decision
source_url: https://linear.app/example/issue/ENG-1234
authority: Linear ENG-1234 (결정권자: PM SY)
tier: 1
tags: "notifications,push,mobile,decision"
sensitivity: private
created_at: 2026-04-29T10:45:00+09:00
---
```

**① 한 줄 요지**
모바일 푸시 알림 전송 주체를 백엔드로 일원화한 결정의 권위는 Linear ENG-1234다.

**② SSOT 위치**
Linear: https://linear.app/example/issue/ENG-1234
Comment by SY (2026-03-10): "푸시는 백엔드 단일 채널로 통일, 프론트 직접 호출 금지"

**③ 전후 컨텍스트**
프론트엔드 팀이 FCM을 직접 호출하는 코드를 추가하다가 이중 발송 버그 발생. 원인 추적 중 ENG-1234에서 이미 결정된 아키텍처임을 발견.

**④ 관련 cross-link**
- 관련: `code-notifications-push-service` (백엔드 푸시 서비스 위치)
- SSOT URL: https://linear.app/example/issue/ENG-1234

---

#### 좋은 예 2

```
---
slug: linear-auth-sso-scope
source_url: https://linear.app/example/issue/ENG-2089
authority: Linear ENG-2089 (결정권자: Lead KS + Security JH)
tier: 1
tags: "auth,sso,saml,enterprise,scope"
sensitivity: private
created_at: 2026-04-29T11:00:00+09:00
discovery_context: 엔터프라이즈 고객 SSO 지원 스펙 검토 중
---
```

**① 한 줄 요지**
v1 SSO는 SAML 2.0만 지원하고 OIDC는 v2로 연기 — ENG-2089에서 확정.

**② SSOT 위치**
Linear: https://linear.app/example/issue/ENG-2089
"Scope Decision" 코멘트 스레드 (KS, JH 합의)

**③ 전후 컨텍스트**
엔터프라이즈 고객이 Azure AD OIDC를 요청했고 지원 범위를 확인하러 찾음. ENG-2089에서 KS와 JH가 SAML만 v1에 포함하고 OIDC는 v2 마일스톤으로 명시적으로 연기 결정.

**④ 관련 cross-link**
- 관련: `github-pr-auth-saml-integration` (SAML 통합 PR)
- SSOT URL: https://linear.app/example/issue/ENG-2089

---

#### 나쁜 예 1

```
---
slug: linear-eng1234-notifications
source_url: https://linear.app/example/issue/ENG-1234
authority: Linear
tier: 2
tags: "notifications"
sensitivity: private
created_at: 2026-04-29T10:45:00+09:00
---
```

**① 한 줄 요지**
ENG-1234 이슈

**② SSOT 위치**
Linear ENG-1234

**③ 전후 컨텍스트**
이슈 내용 확인.

**④ 관련 cross-link**
없음

**위반 이유**: slug `linear-eng1234-notifications`는 slug 원칙 ⑧(출처 의존 금지)를 위반한다 — `eng1234`는 Linear 티켓 번호를 그대로 slug에 넣은 것으로, Linear 없이는 slug만으로 내용을 추론할 수 없다. slug는 출처 시스템에 독립적인 의미론적 식별자여야 한다. `linear-notifications-push-decision`처럼 도메인과 결정 내용을 담아야 한다.

---

### slack

#### 좋은 예 1

```
---
slug: slack-billing-stripe-keys
source_url: https://example.slack.com/archives/C0123ABC/p1711900000000000
authority: KS (결제 도메인 리드, Slack #billing-eng)
tier: 1
tags: "billing,stripe,api-key,environment"
sensitivity: private
created_at: 2026-04-29T17:00:00+09:00
---
```

**① 한 줄 요지**
Stripe 테스트 키와 프로덕션 키 교체 절차는 KS가 #billing-eng 스레드에서 정의했으며, 1Password Vault 경유가 필수다.

**② SSOT 위치**
Slack #billing-eng, 2026-03-28 스레드: https://example.slack.com/archives/C0123ABC/p1711900000000000
KS 메시지: "Stripe 키 교체는 반드시 1Password → ops팀 티켓 → KS 승인 순서"

**③ 전후 컨텍스트**
스테이징에서 프로덕션 Stripe 키가 사용된 인시던트 이후, 키 교체 절차가 없다는 것을 발견. KS가 Slack에서 절차를 정의했고 이것이 현재 유일한 SSOT.

**④ 관련 cross-link**
- 관련: `notion-billing-stripe-contract` (Stripe 계약 개요 문서)
- 관련: `github-issue-ratelimit-decision` (API 정책 결정 예시)

---

#### 좋은 예 2

```
---
slug: slack-deploy-freeze-period
source_url: https://example.slack.com/archives/C0456DEF/p1712500000000000
authority: CTO JH (Slack #engineering-all)
tier: 1
tags: "deployment,freeze,policy,holiday"
sensitivity: private
created_at: 2026-04-29T18:00:00+09:00
discovery_context: 연휴 직전 배포 계획 검토 중
---
```

**① 한 줄 요지**
공휴일 전후 72시간 배포 동결 정책은 CTO JH가 #engineering-all에서 선언했으며 예외는 JH 직접 승인이 필요하다.

**② SSOT 위치**
Slack #engineering-all, 2026-04-03 메시지: https://example.slack.com/archives/C0456DEF/p1712500000000000
JH: "공휴일 전후 72시간은 freeze, 예외는 나한테 직접"

**③ 전후 컨텍스트**
연휴 직전 긴급 배포 요청을 처리하다가 팀 내 freeze 정책 존재를 몰랐음. 이후 배포 전 freeze 기간 여부 확인이 체크리스트에 추가됨.

**④ 관련 cross-link**
- 관련: `github-wiki-deployment-checklist` (배포 체크리스트 Wiki)
- SSOT URL: https://example.slack.com/archives/C0456DEF/p1712500000000000

---

#### 나쁜 예 1

```
---
slug: slack-billing-stripe-keys
source_url: https://example.slack.com/archives/C0123ABC/p1711900000000000
authority: Slack
tier: 2
tags: "stripe"
sensitivity: private
created_at: 2026-04-29T17:00:00+09:00
---
```

**① 한 줄 요지**
Stripe 키 관련 Slack 메시지

**② SSOT 위치**
Slack 링크

**③ 전후 컨텍스트**
KS가 Slack에서 말했다.

**④ 관련 cross-link**
없음

**위반 이유**: `authority` 필드에 "Slack"만 기재하면 누가 결정권자인지 알 수 없다 — Slack은 채널이지 권위자가 아니다. 또한 한 줄 요지가 "Stripe 키 관련 Slack 메시지"로 내용을 전혀 담지 않는다. pin의 핵심 가치는 "검색 비용을 줄이는 것"인데, 이 pin을 읽어도 무엇을 알게 되는지 불분명하다.

---

### notion

#### 좋은 예 1

```
---
slug: notion-onboarding-engineer-setup
source_url: https://www.notion.so/example/Engineer-Onboarding-abc123
authority: Notion Engineer Onboarding 페이지 (유지보수: HR + TG)
tier: 2
tags: "onboarding,setup,environment,engineer"
sensitivity: private
created_at: 2026-04-29T09:30:00+09:00
---
```

**① 한 줄 요지**
신규 엔지니어 개발 환경 셋업의 정식 절차(macOS + Homebrew + Docker)는 Notion Engineer Onboarding 페이지가 SSOT다.

**② SSOT 위치**
Notion: https://www.notion.so/example/Engineer-Onboarding-abc123
"Dev Environment Setup" 섹션 (2026-04-01 TG 갱신)

**③ 전후 컨텍스트**
신입 합류 지원 중 구두로 전달하던 셋업 절차가 사람마다 달라서 혼선 발생. TG가 Notion을 SSOT로 지정하고 팀 공유.

**④ 관련 cross-link**
- 관련: `github-wiki-deployment-checklist` (배포 절차 Wiki)
- SSOT URL: https://www.notion.so/example/Engineer-Onboarding-abc123

---

#### 좋은 예 2

```
---
slug: notion-data-retention-policy
source_url: https://www.notion.so/example/Data-Retention-Policy-def456
authority: Notion Data Retention Policy (결정권자: CPO SY + Legal)
tier: 1
tags: "data,retention,gdpr,compliance,policy"
sensitivity: private
created_at: 2026-04-29T10:00:00+09:00
discovery_context: GDPR 감사 대응 준비 중
---
```

**① 한 줄 요지**
사용자 데이터 보존 기간(계정 탈퇴 후 30일 내 삭제)의 법적 근거 및 정책은 Notion Data Retention Policy가 SSOT다.

**② SSOT 위치**
Notion: https://www.notion.so/example/Data-Retention-Policy-def456
"Deletion Timeline" 섹션 — Legal 검토 완료 (2026-01-15)

**③ 전후 컨텍스트**
GDPR 감사 준비 중 삭제 일정 근거 문서를 찾다 발견. 엔지니어링 일정(30일)과 Legal 요건이 이 문서에서 합의된 기준임을 확인.

**④ 관련 cross-link**
- 관련: `code-billing-stripe-webhook` (결제 데이터 처리)
- SSOT URL: https://www.notion.so/example/Data-Retention-Policy-def456

---

#### 나쁜 예 1

```
---
slug: notion-onboarding-engineer-setup
source_url: https://www.notion.so/example/Engineer-Onboarding-abc123
authority: Notion
tier: 2
tags: "onboarding"
sensitivity: private
created_at: 2026-04-29T09:30:00+09:00
---
```

**① 한 줄 요지**
엔지니어 온보딩 절차

**② SSOT 위치**
Notion 온보딩 페이지

**③ 전후 컨텍스트**
온보딩 절차:
1. Homebrew 설치: `/bin/bash -c "$(curl ...)"`
2. Docker 설치 및 실행
3. 레포 클론: `git clone https://github.com/example/repo`
4. `.env.local` 파일 생성
5. `make setup` 실행
(이하 Notion 페이지 전체 내용 복사)

**④ 관련 cross-link**
없음

**위반 이유**: Notion 페이지의 절차 전체를 pin 본문에 복사했다 — `ssot-no-copy` + `long-body-wrong-ssot` 이중 위반이다. Notion 페이지가 갱신되면 pin은 즉시 stale해지고, 두 곳의 진실이 충돌한다. pin은 "온보딩 절차의 권위가 Notion에 있다"는 포인터 역할만 해야 한다.

---

### person

#### 좋은 예 1

```
---
slug: person-billing-domain-authority
source_url: person:KS
authority: KS (빌링 도메인 리드, 직접 대화)
tier: 1
tags: "billing,domain-knowledge,ownership,person"
sensitivity: private
created_at: 2026-04-29T15:00:00+09:00
---
```

**① 한 줄 요지**
빌링 도메인(Stripe 연동, 인보이스 발행, 환불 정책)의 유일한 인간 권위자는 KS다.

**② SSOT 위치**
person:KS — 직접 질문이 최단 경로.
보조 SSOT: Slack #billing-eng (KS 활동 채널)

**③ 전후 컨텍스트**
환불 예외 케이스 처리 방법을 코드와 문서에서 찾지 못하고 KS에게 직접 물어봐서 해결. 이 도메인은 문서화가 부족하고 KS가 암묵지를 보유 중.

**④ 관련 cross-link**
- 관련: `slack-billing-stripe-keys` (KS가 정의한 키 교체 절차)
- 관련: `notion-billing-stripe-contract` (보조 문서)

---

#### 좋은 예 2

```
---
slug: person-infra-oncall-rotation
source_url: person:TG
authority: TG (인프라 온콜 스케줄 관리자)
tier: 2
tags: "infra,oncall,rotation,person,ops"
sensitivity: private
created_at: 2026-04-29T16:00:00+09:00
discovery_context: 새벽 인시던트 에스컬레이션 경로 확인 중
---
```

**① 한 줄 요지**
인프라 온콜 로테이션 스케줄과 에스컬레이션 매트릭스는 TG가 관리하며 문서화된 SSOT가 없다.

**② SSOT 위치**
person:TG — Slack DM 또는 #infra-ops 멘션.
(공식 문서 없음 — v2에서 Notion 문서화 예정)

**③ 전후 컨텍스트**
새벽 3시 DB 장애 에스컬레이션 중 누구에게 연락해야 하는지 몰라서 지연. TG가 온콜 스케줄을 머릿속에만 가지고 있음을 확인.

**④ 관련 cross-link**
- 관련: `github-wiki-deployment-checklist` (배포 절차 중 에스컬레이션 항목)
- 관련: `slack-deploy-freeze-period` (배포 동결 정책)

---

#### 나쁜 예 1

```
---
slug: person-ks-said-billing-stuff
source_url: person:KS
authority: KS
tier: 2
tags: "billing,person"
sensitivity: private
created_at: 2026-04-29T15:00:00+09:00
---
```

**① 한 줄 요지**
KS가 빌링에 대해 아는 사람이다.

**② SSOT 위치**
KS에게 물어보면 됨.

**③ 전후 컨텍스트**
KS와 대화함.

**④ 관련 cross-link**
없음

**위반 이유**: slug `person-ks-said-billing-stuff`는 원칙 ⑥(동사/형용사 금지 — `said`는 동사), ⑦(시간제한사 금지 — `said`는 과거 시점 의존), ⑧(출처 의존 금지 — `ks`를 그대로 slug에 넣음) 세 가지를 동시에 위반한다. 또한 한 줄 요지가 "KS가 아는 사람이다"로 어떤 도메인 지식도 전달하지 못한다. `person-billing-domain-authority`처럼 도메인과 역할 중심 slug를 써야 한다.
