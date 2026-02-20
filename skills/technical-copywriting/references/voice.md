# Voice & Authenticity Review

## Role

Reviews tone, authenticity, and language quality. Verifies developer audience alignment, anti-marketing-speak, platform tone, reader connection, and Korean naturalness.

## Process

### Step 1: Developer Audience Authenticity

CP11. Developer audience authenticity:

Write like sharing with a peer, not promoting to a customer. Developer audiences detect and reject promotional language instantly.

Signals of authentic developer voice:
- First-person experience: "직접 해보니..." / "제가 경험한..."
- Depth of reflection: Processing what was learned, not just reporting results
- Acknowledging gaps: "이것도 아직 모르겠습니다" / "전부 이해한 것도 아닌 듯합니다"
- Showing the messy process: "찜찜했습니다" / "진땀 빼야 하죠"
- Technical specificity: Concrete tools, concepts, book titles

Anti-patterns:
- Third-person detachment: "본 기술 블로그에서는 ~ 분석합니다"
- Product-launch framing: "We're excited to announce..."
- Authority without evidence: "The best way to..." without showing why
- Surface-level reporting without reflection

Before:
> 이 글에서는 효과적인 캐싱 전략을 소개합니다. 최적의 방법론을 통해 성능을 극대화할 수 있습니다.

After:
> 그동안 소프트웨어 아키텍처나 디자인 패턴에는 관심이 많았으면서도, 왜 그 앞단인 요구사항 작성에는 이렇게 무심했을까, 스스로 놀라웠습니다.

### Step 2: Anti-Marketing-Speak

CP12. Anti-marketing-speak:

Ban list (flag if found):
- "game-changer" / "판도를 바꾸는"
- "revolutionary" / "혁신적인"
- "must-read" / "필독"
- "amazing" / "놀라운"
- "incredible" / "믿을 수 없는"
- "you won't believe" / "믿기 힘들겠지만"
- "ultimate guide" / "완벽 가이드"
- "secret" / "비밀"
- "hack" (when meaning tip) / "꿀팁"

Replace with specific claims:

Before: "놀라운 성능 향상을 경험했습니다"
After: "콜드 스타트 시간이 40% 줄었습니다"

Before: "혁신적인 모니터링 방법을 소개합니다"
After: "알림 피로를 줄이면서 장애 탐지 시간을 15분에서 2분으로 단축한 방법"

### Step 3: Platform-Specific Tone

CP13. Platform-specific tone:

| Platform | Tone | Register | Characteristics |
|----------|------|----------|-----------------|
| LinkedIn | Professional but personal | Semi-formal | Authenticity is the foundation of, not the alternative to, thought leadership. Lead with genuine experience or original analysis. Substance over posturing. |
| Slack | Casual, collegial | Informal | Write like messaging a teammate. Brief. |
| Twitter/X | Punchy, direct | Informal-concise | No verbose intros. Every word earns its place. |
| Newsletter | Conversational authority | Semi-formal | Brief and focused. Subscriber knows you. |

LinkedIn primary anti-pattern for developer audiences:
- Empty credential assertions ("10년간 전문가로 활동하며...")
- Corporate voice or third-person detachment
- Claims of expertise without evidence (specific results, concrete examples)

Before (LinkedIn, empty credential):
> 저는 10년간 마이크로서비스 아키텍처 전문가로 활동하며 수백 개의 시스템을 설계해왔습니다.

After (LinkedIn, substance-first):
> 서비스가 5개를 넘어가면 동기 통신만으로는 한계가 옵니다. 장애 전파, 결합도, 확장성 — 3가지 문제를 비동기 전환으로 해결한 과정을 정리했습니다.

### Step 4: Reader Connection

CP14. Reader connection:

Effective connection strategies for developer audiences:

**Vulnerability-based (first-person):**
- Admitting ignorance: "전혀 모르고 있다는 사실을 깨달았습니다"
- Sharing struggle: "읽는 과정은 쉽지 않았습니다"
- Ongoing imperfection: "아직 읽은 것 전부를 이해한 것도 아닌 듯합니다"

**Reader-directed ("you"):**
- Problem identification: "CI 빌드에 매번 18분 기다리고 계신가요?"
- Shared challenge: "트랜잭션 격리 레벨 설명하기 어렵지 않으셨나요?"
- Direct benefit: "캐시 전략 하나로 7분까지 줄일 수 있습니다"

Both approaches are valid. Choose based on the teaser type:
- Learning Journey → vulnerability-based fits naturally
- Practical Tip → reader-directed fits naturally
- Mix freely within other types

Anti-pattern: condescending or quiz-like tone regardless of approach.

Before (condescending):
> 동기화, 알고 계신가요? 정확하게 정의하실 수 있으신가요? 대부분의 개발자들이 이 개념을 정확히 모릅니다.

After (genuine reader-directed):
> 트랜잭션 격리 레벨 설명하기 어렵지 않으셨나요? 저도 그랬습니다. Kleppmann의 DDIA를 기반으로 정리해봤습니다.

### Step 5: Korean Naturalness

CP15. Korean naturalness (when Korean text):

Apply technical-writing principles T10 (remove unnecessary Sino-Korean) and T11 (no translationese). Technical copywriting in Korean should sound natural, not translated from English marketing copy.

Natural Korean voice markers (positive signals):
- "~이죠" (soft continuation): "그 자체로도 훌륭한 산출물이 되죠"
- "~였죠" (retrospective): "무엇을 모르는지도 모르는 상태였죠"
- "~겠더군요" (experiential realization): "결국 '알아야' AI도 써먹을 수 있겠더군요"
- "~이죠.. / ~입니다.." (double period for weight/pause)
- Natural spoken rhythm over formal written style

Sino-Korean bloat:
Before: "성능 개선 작업 수행 결과를 공유드립니다"
After: "성능을 개선한 결과를 공유합니다"

Translationese from English marketing:
Before: "저는 ~에 대해 열정적입니다" (I'm passionate about...)
After: "~을 꾸준히 파고 있습니다"

Before: "이 접근법은 당신의 CI/CD를 다음 레벨로 가져갈 것입니다"
After: "이 방법으로 CI/CD 빌드 시간을 절반으로 줄일 수 있습니다"
