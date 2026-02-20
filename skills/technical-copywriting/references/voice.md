# Voice & Authenticity Review

## Role

Reviews tone, authenticity, and language quality of teaser text. Verifies developer audience alignment, anti-marketing-speak compliance, platform-appropriate tone, conversational connection, and Korean naturalness.

## Process

### Step 1: Developer Audience Authenticity

**CP8. Developer audience authenticity:**

Write like sharing with a peer, not promoting to a customer. Developer audiences detect and reject promotional language instantly.

Signals of authentic developer voice:
- First-person experience: "I found that..." / "직접 해보니..."
- Technical specificity: Concrete tools, versions, metrics
- Acknowledging tradeoffs: "This approach has downsides too"
- Showing the messy process: "We tried X first, it failed because..."

Anti-patterns:
- Third-person detachment: "This article shows..." / "이 글에서는..."
- Product-launch framing: "We're excited to announce..."
- Authority without evidence: "The best way to..." without showing why

Before:
> 이 글에서는 효과적인 캐싱 전략을 소개합니다. 최적의 방법론을 통해 성능을 극대화할 수 있습니다.

After:
> Redis 캐시 TTL을 30분에서 5분으로 줄였더니 오히려 히트율이 올라갔습니다. 직관과 반대되는 결과라 원인을 파봤습니다.

### Step 2: Anti-Marketing-Speak

**CP9. Anti-marketing-speak:**

Ban list (flag if found):
- "game-changer" / "판도를 바꾸는"
- "revolutionary" / "혁신적인"
- "must-read" / "필독"
- "amazing" / "놀라운"
- "incredible" / "믿을 수 없는"
- "you won't believe" / "믿기 힘들겠지만"
- "ultimate guide" / "완벽 가이드"
- "secret" / "비밀"
- "hack" (when meaning tip, not security) / "꿀팁"

Replace with specific claims:

Before: "놀라운 성능 향상을 경험했습니다"
After: "콜드 스타트 시간이 40% 줄었습니다"

Before: "This game-changing approach to caching..."
After: "Switching from LRU to LFU cut our cache miss rate from 34% to 12%."

Before: "혁신적인 모니터링 방법을 소개합니다"
After: "알림 피로를 줄이면서 장애 탐지 시간을 15분에서 2분으로 단축한 방법"

Corporate/promotional language alienates developer audiences. Developers trust specificity, not superlatives.

### Step 3: Platform-Specific Tone

**CP10. Platform-specific tone:**

| Platform | Tone | Register | Characteristics |
|----------|------|----------|-----------------|
| LinkedIn | Professional but personal | Semi-formal | Thought leadership framing. Story arc. |
| Slack | Casual, collegial | Informal | Write like messaging a teammate. Brief. |
| Twitter/X | Punchy, direct | Informal-concise | No verbose intros. Every word earns its place. |
| Newsletter | Conversational authority | Semi-formal | Brief and focused. Subscriber knows you. |

Before (Slack, too formal):
> 안녕하세요, 팀원 여러분. 금번 CI/CD 파이프라인 최적화 프로젝트의 결과를 공유드립니다. 해당 내용을 블로그에 정리하였으니, 검토 후 의견 주시면 감사하겠습니다.

After (Slack, collegial):
> CI 빌드 18분 → 7분 줄인 과정 정리했어요
> - 캐시 전략 변경이 제일 효과 컸음
> - 병렬 실행으로 추가 30% 단축
> https://blog.example.com/ci-optimization

Before (Twitter/X, too verbose):
> 오늘 블로그에 새로운 글을 올렸습니다. CI/CD 파이프라인을 최적화한 경험에 대해 자세히 작성했으니 시간 되실 때 한번 읽어보시면 좋겠습니다.

After (Twitter/X, punchy):
> CI 빌드 18분 → 7분.
> 바꾼 건 캐시 전략 하나.
> [link]

### Step 4: Conversational Connection

**CP11. Conversational connection:**

- Use "you" more than "we" or "I": Shift focus to the reader's benefit
- Ask genuine questions (not rhetorical marketing questions)
- Show vulnerability: "I struggled with X until..." / "X 때문에 한참 헤맸는데..."

Before (self-focused):
> 저는 3주간 CI 최적화를 진행했고, 많은 것을 배웠습니다. 제가 경험한 내용을 정리했습니다.

After (reader-focused):
> CI 빌드에 매번 18분 기다리고 계신가요? 캐시 전략 하나로 7분까지 줄일 수 있습니다.

Before (rhetorical marketing question):
> 당신의 CI 파이프라인은 안녕하신가요? 혹시 최적화가 필요하지 않으신가요?

After (genuine question):
> CI 빌드에서 가장 시간 잡아먹는 스텝이 뭔가요? 저는 Docker build였는데, 캐시 전략 바꾸니 거기서만 8분 줄었습니다.

### Step 5: Korean Naturalness

**CP12. Korean naturalness (when Korean text):**

Apply technical-writing principles T10 (remove unnecessary Sino-Korean) and T11 (no translationese) to teaser text. Technical copywriting in Korean should sound natural, not translated from English marketing copy.

Common violations in Korean teaser text:

**Sino-Korean bloat:**

Before: "성능 개선 작업 수행 결과를 공유드립니다"
After: "성능을 개선한 결과를 공유합니다"

Before: "해당 내용에 대한 검토 진행 부탁드립니다"
After: "읽어보시고 의견 주세요"

**Translationese from English marketing:**

Before: "이 접근법은 당신의 CI/CD를 다음 레벨로 가져갈 것입니다"
After: "이 방법으로 CI/CD 빌드 시간을 절반으로 줄일 수 있습니다"

Before: "저는 ~에 대해 열정적입니다" (I'm passionate about...)
After: "~을 꾸준히 파고 있습니다"

**Unnecessary formality in casual platforms:**

Before (Slack): "금번 프로젝트 결과를 공유드리오니 참고 부탁드립니다"
After (Slack): "이번 프로젝트 결과 정리했어요. 한번 봐주세요"
