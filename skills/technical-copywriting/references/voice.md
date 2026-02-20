# Voice & Authenticity Review

## Role

Reviews tone, authenticity, and language quality. Verifies developer audience alignment, anti-marketing-speak, platform tone, vulnerability-based connection, authority anchoring, and Korean naturalness.

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
| LinkedIn | Professional but personal | Semi-formal | Reflective learner framing. Personal narrative arc. NOT thought-leader posturing. |
| Slack | Casual, collegial | Informal | Write like messaging a teammate. Brief. |
| Twitter/X | Punchy, direct | Informal-concise | No verbose intros. Every word earns its place. |
| Newsletter | Conversational authority | Semi-formal | Brief and focused. Subscriber knows you. |

Before (LinkedIn, thought-leader posturing):
> 저는 10년간 마이크로서비스 아키텍처 전문가로 활동하며 수백 개의 시스템을 설계해왔습니다.

After (LinkedIn, reflective learner):
> 다행히도 좋은 멘토들을 만나 백엔드 전반적인 지식을 올바른 방향으로 쌓을 수 있었죠. 레이어드 아키텍처와 클린 아키텍처에 대한 오해를 바로 잡고...

### Step 4: Vulnerability-Based Connection

CP14. Vulnerability-based connection:

Connection comes from shared vulnerability, not from reader-directed "you" language.

Primary connection mechanisms:
- Admitting ignorance: "전혀 모르고 있다는 사실을 깨달았습니다"
- Sharing struggle: "읽는 과정은 쉽지 않았습니다"
- Ongoing imperfection: "아직 읽은 것 전부를 이해한 것도 아닌 듯합니다"
- Shared experience: "제게는 이런 잘못알고 있는 지식이 꽤 있습니다"

"You" language is optional, not required. First-person vulnerability IS the connection.

Before (forced "you" pivot):
> CI 빌드에 매번 18분 기다리고 계신가요? 캐시 전략 하나로 7분까지 줄일 수 있습니다.

After (vulnerability-based):
> 결국 '알아야' AI도 써먹을 수 있겠더군요. AI가 생산성 향상에 큰 도움을 주는 도구라는 것은 부정할 수 없습니다. 하지만 문제 해결에 언제나 올바른 대답을 제공한다고 보기엔 힘듭니다.

Note: Reader-directed "you" language is not WRONG -- it's simply not the only way to create connection. Both approaches are valid. Flag only when "you" language feels forced or marketing-like ("~하고 계신가요?").

### Step 5: Authority Anchoring via Citation

CP15. Authority anchoring:

Credibility comes from demonstrated reading and study, not from personal achievement claims.

Citation patterns:
- Parenthetical: "(리팩터링 2판, 마틴 파울러)"
- Inline reference: "데이터 중심 애플리케이션 설계'(Martin Kleppmann, 2017)에서도 강조하고 있습니다"
- Book list: Enumerated reading list with author names and years
- Expert name: "마틴 파울러", "에릭 에반스" as intellectual anchors

Authority signals that build trust:
- Listing multiple books read on a topic (shows depth of study)
- Citing specific quotes from authoritative sources
- Naming mentors or educators who influenced the learning
- Referencing specific frameworks/concepts by their proper names

Anti-patterns:
- Self-credential claims: "10년 경력의 전문가로서..."
- Unattributed claims: Making authoritative statements without citing sources
- Name-dropping without substance: Mentioning experts without connecting to the content

Before (self-credential):
> 시니어 개발자로서 말씀드리자면, 트랜잭션 격리 레벨은 이렇게 이해하시면 됩니다.

After (authority anchoring):
> 이 분야의 고전이라 불리는 '데이터 중심 애플리케이션 설계'(Martin Kleppmann, 2017)에서도 강조하고 있습니다. "트랜잭션의 일관성은 데이터베이스 시스템의 원자성과 격리성에 기대어 구현될 수 있다."

### Step 6: Korean Naturalness

CP16. Korean naturalness (when Korean text):

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
