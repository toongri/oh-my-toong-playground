# Sentence Review

## Role

Reviews sentence-level expressions. Verifies subject clarity, conciseness, specificity, consistency, and Korean naturalness.

## Process

### Step 1: Subject Clarity

**T1. Do not use tools/technologies as sentence subject:**

Before: "이 라이브러리는 데이터베이스 초기화를 수행해요."
After: "이 명령어를 실행하면 데이터베이스를 초기화할 수 있어요."

Exception: When explaining the tool's own behavior, the tool may be the subject.
- Allowed: "Impression 로그는 두 가지 방식으로 동작해요."

**T2. Convert passive voice to active voice:**

Before: "애플리케이션이 실행되기 전에 설정이 완료되어야 합니다."
After: "애플리케이션을 실행하기 전에 설정을 완료하세요."

### Step 2: Conciseness

**T3. Split long sentences** (one thought per sentence):

Before: "이 API를 호출할 때 요청 헤더를 포함해야 하며, 올바른 인증 정보를 제공해야 정상적으로 응답을 받을 수 있습니다."
After: "이 API를 호출할 때 요청 헤더와 인증 정보를 포함하세요."

Before: "버튼을 클릭하면 다음 단계로 이동하게 되며, 그 이후의 작업을 진행할 수 있습니다."
After: "버튼을 클릭하면 다음 단계로 이동합니다. 이동 후 이어서 작업을 진행하세요."

**T4. Remove meta-discourse** (delete talk about talk):

Targets: "앞서 설명했듯이", "이제 알아보겠습니다", "아시다시피", "결론적으로", "간단히 말하면"

Before: "앞에서 설명했지만, 결론은 이 설정을 변경하는 것이 가장 효과적인 방법이라는 겁니다."
After: "이 설정을 변경하는 것이 가장 효과적인 방법입니다."

### Step 3: Specificity

**T5. Use verbs instead of nominalizations** (eliminate verb-derived noun forms):

Before: "코드 최적화 진행 후 배포 수행이 필요합니다."
After: "코드를 최적화한 후 배포하세요."

Before: "MongoDB 연결 정보 설정 및 초기화가 필요합니다."
After: "MongoDB에 연결할 호스트와 포트를 설정하고 데이터베이스를 초기화합니다."

**T6. Replace vague expressions with specific ones:**

Before: "일부 브라우저에서 정상적으로 동작하지 않을 가능성이 있습니다."
After: "Internet Explorer에서는 정상적으로 동작하지 않습니다."

**T7. Never omit who/what/where/how:**

Before: "파일을 업로드하면 자동으로 저장됩니다."
After: "사용자가 파일을 업로드하면 서버에 자동으로 저장됩니다."

Before: "설정을 변경하면 적용됩니다."
After: "관리자가 설정을 변경하면 변경 사항이 프로덕션 환경에 즉시 적용됩니다."

Before: "에러가 발생하면 로그를 확인하세요."
After: "에러가 발생하면 애플리케이션 서버에서 에러 로그 파일(`/var/log/app/error.log`)을 확인하세요."

**T8. Provide specific numbers:**

Before: "데이터가 많을 때는 성능이 저하될 수 있습니다."
After: "데이터가 10,000건을 넘으면 응답 시간이 1초 이상 걸립니다."

**T16. Write to reveal actual behavior** (replace industry jargon/metaphors with expressions showing actual behavior):

Before: "에러가 발생하면 Exception을 던집니다."
After: "에러가 발생하면 예외(`Exception`)를 일으킵니다."

**T9. Make cross-references explicit** (connect preceding/following steps):

Before:
> 1. API 키를 생성합니다. `apiKey` 변수에 저장합니다.
> 3. `apiKey`로 API 인증을 수행합니다.

After:
> 1. API 키를 생성하고 `apiKey` 변수에 저장합니다. 이 키는 3단계에서 API 키 인증에 사용됩니다.
> 3. 1단계에서 `apiKey`에 저장한 API 키로 인증합니다.

### Step 4: Consistency

**T12. Use official technical terms:**

Before: "K8을 사용하면..."
After: "쿠버네티스(Kubernetes)를 사용하면..."

**T13. Use consistent expressions for the same concept:**

Before: "파일을 추가... 파일을 첨부... 파일을 다시 넣을 수 있습니다."
After: "파일을 업로드... 파일을 업로드한 후... 파일을 다시 업로드할 수 있습니다."

**T14. Expand abbreviations on first use** (no space between abbreviation and parentheses):

Before: "이 기능은 SSR을 지원합니다."
After: "이 기능은 SSR(Server-Side Rendering)을 지원합니다."

**T15. Foreign word notation: prioritize usage frequency** (if Google Trends shows 5x+ difference, use common spelling):

Before: "프런트엔드"
After: "프론트엔드"

### Step 5: Korean Naturalness

**T10. Remove unnecessary Sino-Korean words** (eliminate unnecessary '수행하다', '진행하다', '실행하다'):

Before: "로그 파일을 삭제하는 작업을 수행합니다."
After: "로그 파일을 삭제합니다."

**T11. Convert translationese to verb-centric Korean:**

Before: "API 키를 이용한 사용자 인증 처리가 완료된 후, 데이터베이스 접속 설정 진행이 가능합니다."
After: "API 키로 사용자를 인증한 후, 데이터베이스에 접속하도록 설정할 수 있습니다."

Before: "시스템 모니터링 수행을 통해 서버 성능 측정 작업을 실시하게 됩니다."
After: "시스템을 모니터링해서 서버 성능을 측정합니다."

Before: "보안 정책 업데이트 진행 후 시스템 재시작 처리를 수행해야 합니다."
After: "보안 정책을 업데이트한 후 시스템을 재시작합니다."
