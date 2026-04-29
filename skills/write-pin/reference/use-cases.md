# Use Cases: Write-Pin 컨텍스트 시나리오

AI가 작업 중 컨텍스트가 필요할 때 어떻게 행동해야 하는지를 5가지 시나리오로 정리한다.
각 시나리오는 AC-17.5a~e의 검증 기준이며, T24 writing-skills RED-GREEN-REFACTOR 시뮬레이션의 테스트 픽스처로도 사용된다.

---

## Use cases

### 시나리오 A

**유형**: hit — pin 존재, 내용 정확

**상황**: AI가 "auth 도메인의 권위는 어디에 있는가?"를 확인해야 한다. 사용자가 이전 세션에서 이미 발견해 pin을 저장해뒀다.

**결정 흐름**:

- `select-pin` 스킬을 invoke해 `$OMT_DIR/pins/` 디렉토리를 조회한다.
- slug `code-auth-verifytoken-2024` 핀의 frontmatter를 읽는다.
- `authority: auth/jwt.ts` + `source_url: https://github.com/...` 확인 → 현재 작업 컨텍스트와 일치.
- 본문 4섹션을 읽어 한 줄 요지 + SSOT 위치를 파악한다.
- 해당 정보를 그대로 사용해 작업을 계속한다.

**emit 결과**: emit 안 함 (emit: 없음)

pin이 이미 정확하고 최신이므로 새 pin을 emit할 필요가 없다. 중복 indexing은 오히려 혼란을 야기한다.

**왜 이게 올바른 응답인가**: 이미 신뢰할 수 있는 인덱스가 존재한다. pin 시스템의 목적은 "발견 비용을 다시 치르지 않기"이지, 같은 정보를 반복해서 박는 것이 아니다.

---

### 시나리오 B

**유형**: stale — pin 존재, 내용 오래됨/틀림

**상황**: AI가 rate-limit 정책 권위를 확인하러 `select-pin`을 invoke했더니 `decision-ratelimit-ks-2024`라는 핀이 있다. 그런데 핀 본문에는 "KS가 결정권자"라고 되어 있는데, 사용자가 "KS가 퇴사해서 이제 JH가 결정권자야"라고 알려준다.

**결정 흐름**:

- 기존 pin의 `source_url: person:KS` + `authority: KS` 확인 → 잘못된 정보.
- 사용자와 짧은 인터뷰: "JH가 새로운 결정권자, Slack #eng-billing 채널에 결정 기록 있음".
- 관련 문서(Slack thread 링크)를 확인해 정확한 권위를 파악한다.
- `write-pin` 스킬을 invoke해 형식을 학습하고 갱신 pin을 emit한다.
- 새 pin에 `supersedes: decision-ratelimit-ks-2024` 속성을 포함시켜 기존 핀을 덮어쓴다고 명시한다.

**emit 결과**:

```xml
<pin slug="decision-ratelimit-jh-2025"
     source_url="https://acme.slack.com/archives/C123/p1700000001"
     authority="JH"
     tier="2"
     tags="ratelimit,billing,decision"
     sensitivity="internal"
     supersedes="decision-ratelimit-ks-2024"
     discovery_context="사용자가 KS 퇴사 사실 알려줌 — billing 정책 검토 중">
**한 줄 요지**: rate-limit 결정권자는 JH (KS 퇴사 후 이관).

**SSOT 위치**: Slack #eng-billing 2025-03-10 thread — JH가 직접 결정 공지.

**전후 컨텍스트**: billing 도메인 정책 리뷰 중 기존 pin이 stale임을 사용자가 확인. KS→JH 이관.

**관련 cross-link**: related: [decision-billing-jh-2025]
</pin>
```

**왜 이게 올바른 응답인가**: stale pin을 그냥 두면 다음 세션에서 AI가 틀린 정보를 다시 사용할 수 있다. `supersedes` 속성으로 이전 pin을 명시적으로 무효화해야 인덱스 정합성이 유지된다.

---

### 시나리오 C

**유형**: miss + AI 직접 발견 — pin 없음, 사용자도 모름, AI가 문서에서 발굴

**상황**: AI가 "JWT 검증 로직의 진짜 권위는 어디에 있는가?"를 알아야 한다. `select-pin` 조회 결과 관련 pin이 없다. 사용자에게 물었지만 "나도 잘 모르겠어, 코드베이스 어딘가에 있을 거야"라고 답한다.

**결정 흐름**:

- `$OMT_DIR/pins/` 조회 결과 관련 pin 없음 확인.
- 사용자도 정보 없음 → AI가 직접 코드베이스를 탐색한다.
- `auth/jwt.ts:142` 의 `verifyToken` 함수 발견 — 실제 검증 로직 + 주석에 "single source of truth for token validation" 명시.
- `write-pin` 스킬 invoke → 형식 학습 → **신규** pin emit.

**emit 결과** (emit ✓):

```xml
<pin slug="code-auth-verifytoken"
     source_url="https://github.com/acme/backend/blob/main/auth/jwt.ts#L142"
     authority="auth/jwt.ts:verifyToken"
     tier="1"
     tags="auth,jwt,verification"
     sensitivity="internal"
     discovery_context="billing-claim 검증 중 JWT 권위 탐색 → 코드베이스 직접 grep">
**한 줄 요지**: JWT 토큰 검증의 SSOT는 auth/jwt.ts:142 verifyToken 함수.

**SSOT 위치**: auth/jwt.ts line 142 — "single source of truth for token validation" 주석 명시.

**전후 컨텍스트**: billing claim 검증 로직 구현 중 JWT 검증 권위를 알아야 했음. 사용자도 모름 → 직접 발굴.

**관련 cross-link**: related: []
</pin>
```

**왜 이게 올바른 응답인가**: 사용자도 모르는 상태에서 AI가 직접 발굴한 신규 지식은 반드시 pin으로 박아야 한다. 다음 세션에서 같은 탐색 비용을 다시 치르지 않기 위함이다. 신규 발견이므로 supersedes 없이 신규 pin을 emit한다.

---

### 시나리오 D

**유형**: miss + 사람 정보원 — pin 없음, 사용자가 특정인을 권위자로 지목

**상황**: AI가 billing 도메인의 비즈니스 규칙을 알아야 한다. `select-pin` 조회 결과 없음. 사용자가 "그건 A팀장에게 있다더라, 코드나 문서에 없고 머릿속에 있어"라고 알려준다.

**결정 흐름**:

- `$OMT_DIR/pins/` 조회 결과 관련 pin 없음 확인.
- 사용자가 권위자를 명시: "A팀장이 billing 규칙의 SSOT".
- 문서나 코드에서 확인 불가 — 사람 머릿속이 SSOT.
- `write-pin` 스킬 invoke → `source_url: person:A팀장` 패턴 학습 → pin emit.
- `source_url`에 `person:A팀장` 형식으로 사람 권위자를 식별한다.

**emit 결과**:

```xml
<pin slug="person-billing-A-rules"
     source_url="person:A팀장"
     authority="A팀장 (billing domain owner)"
     tier="3"
     tags="billing,business-rule,person"
     sensitivity="internal"
     discovery_context="billing claim 처리 로직 구현 중 — 사용자가 A팀장이 권위자라고 알려줌">
**한 줄 요지**: billing 비즈니스 규칙의 SSOT는 A팀장 머릿속 — 문서/코드 미존재.

**SSOT 위치**: person:A팀장 — 직접 인터뷰 필요. 현재 코드베이스나 문서에 명시된 위치 없음.

**전후 컨텍스트**: billing claim 처리 중 규칙 불명확. 사용자 왈: "A팀장에게 있다더라". 문서화 필요.

**관련 cross-link**: related: []
</pin>
```

**왜 이게 올바른 응답인가**: `person:이름` 식별자는 사람이 SSOT인 경우를 명시적으로 표현하는 핀 시스템의 지원 패턴이다. "모른다"가 아니라 "A팀장에게 가야 한다"는 사실 자체가 가치 있는 메타지식이다.

---

### 시나리오 E

**유형**: miss + 미상 — pin 없음, 아무도 모름

**상황**: AI가 레거시 payment 모듈의 결제 수수료 계산 로직 권위를 파악해야 한다. `select-pin` 조회 결과 없음. 사용자에게 물었더니 "나도 몰라, 팀에 아는 사람이 없어, 코드 어딘가에 있겠지"라고 답한다. AI가 코드베이스를 탐색했지만 명확한 SSOT를 찾지 못했다.

**결정 흐름**:

- `$OMT_DIR/pins/` 조회 결과 관련 pin 없음 확인.
- 사용자도 모름, 팀도 모름.
- 코드베이스 탐색: `payments/fee.ts`에 로직이 있긴 한데 권위 주석 없고, 히스토리도 불명확.
- 완전히 미상 상태 — 그러나 이 "모른다"는 사실 자체를 기록해야 한다.
- `write-pin` 스킬 invoke → placeholder pin emit. 나중에 발견 시 `supersedes`로 갱신.

**emit 결과**:

```xml
<pin slug="finding-payment-fee-unknown"
     source_url="https://github.com/acme/backend/blob/main/payments/fee.ts"
     authority="unknown — 조사 필요"
     tier="4"
     tags="payment,fee,placeholder,unknown"
     sensitivity="internal"
     discovery_context="payment 수수료 계산 PR 리뷰 중 권위 불명. 팀 전원 미인지.">
**한 줄 요지**: payment 수수료 계산 로직 권위 미상 — placeholder, 향후 발견 시 supersedes로 갱신 필요.

**SSOT 위치**: payments/fee.ts에 로직 존재하나 권위 명시 없음. 원작자 불명, 히스토리 불명확.

**전후 컨텍스트**: payment 수수료 로직 수정 PR 리뷰 중 발생. 사용자 및 팀 전원 권위 미인지. 조사 필요.

**관련 cross-link**: related: []
</pin>
```

**왜 이게 올바른 응답인가**: "모른다"는 사실을 placeholder pin으로 박아두면 다음 세션에서 AI가 "이미 조사했고 미상임"을 알 수 있다. 발견 시 `supersedes: finding-payment-fee-unknown`으로 갱신하면 된다. 아무것도 안 하는 것보다 placeholder가 훨씬 유용하다.

---

## 설계 의도

이 5가지 시나리오는 pin 시스템의 핵심 분기를 커버한다:

| 시나리오 | 상태 | emit 여부 | 핵심 패턴 |
|---|---|---|---|
| A | hit | emit 안 함 | 중복 박기 금지 |
| B | stale | emit + supersedes | 인덱스 정합성 유지 |
| C | miss (AI 발굴) | 신규 emit | 발견 비용 결정화 |
| D | miss (사람 정보원) | emit (person:) | 사람 SSOT 명시 |
| E | miss (미상) | placeholder emit | 미상 사실도 가치 있음 |

**불변 원칙**: pin은 indexing이지 wiki가 아니다. 위치(source_url) + 권위 + 한 줄 요지 + 컨텍스트만 박는다.
