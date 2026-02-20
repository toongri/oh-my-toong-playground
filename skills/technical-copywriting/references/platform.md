# Platform Classification

## Role

Identifies the target sharing platform and verifies that platform-specific constraints are met.

## Process

### Step 1: Platform Identification

**CP1. Platform identification criteria:**

| Platform | Characteristics | Typical Format |
|----------|----------------|----------------|
| LinkedIn | Professional network post | Long-form with paragraphs or bullets |
| Slack | Team/community channel share | Short message with inline link |
| Twitter/X | Tweet or thread | 280-char limit or multi-tweet thread |
| Newsletter | Email intro section | Subject line + preview + body |

Classification signals:
- Mentions "LinkedIn", professional audience, thought leadership framing → LinkedIn
- Mentions channel name, team context, casual tone → Slack
- Character count under 280, thread format, hashtags → Twitter/X
- Mentions subscribers, email, "this week" framing → Newsletter
- If platform is ambiguous, ask the user before proceeding

### Step 2: Platform Constraint Compliance

**CP2. Platform constraint compliance:**

| Platform | Max Length | Link Placement | Format |
|----------|-----------|----------------|--------|
| LinkedIn | 3000 chars (140 before fold) | First comment (recommended) | Paragraph or bullet list |
| Slack | No hard limit (3-5 lines ideal) | Inline, upfront | TL;DR + bullets |
| Twitter/X | 280 chars (or thread) | End of thread | Single tweet or thread |
| Newsletter | ~100 words intro | "Read more" CTA button | Subject line + preview + body |

Before (LinkedIn, 200+ chars before fold):
> 최근에 우리 팀에서 진행한 성능 최적화 프로젝트에서 정말 흥미로운 결과를 얻었습니다. 이번 글에서는 그 과정과 결과를 상세히 공유하고자 합니다. 먼저 배경부터 설명하면...

After (LinkedIn, key message within 140 chars):
> CI 파이프라인 실행 시간을 18분에서 7분으로 줄였습니다.
>
> 우리 팀이 3주간 진행한 성능 최적화에서 얻은 핵심 교훈 3가지를 공유합니다.

Before (Twitter/X, over 280 chars in single tweet):
> 최근 블로그에 CI/CD 파이프라인 최적화에 대한 글을 올렸습니다. 캐시 전략 변경, 병렬 실행 도입, 불필요한 스텝 제거 등을 통해 빌드 시간을 60% 단축한 경험을 정리했으니 관심 있으신 분들은 읽어보시면 좋을 것 같습니다.

After (Twitter/X, fits 280 chars):
> CI 빌드 18분 → 7분으로 단축.
>
> 캐시 전략 하나 바꿨을 뿐인데 60% 빨라졌습니다.
>
> 전체 과정 정리: [link]

### Step 3: Platform-Specific Format Rules

**CP3. Platform-specific format rules:**

**LinkedIn:**
- Critical first 2 lines (before "see more" fold). Front-load the hook.
- External links in post body suppress algorithmic reach. Recommend placing link in first comment.
- Use line breaks liberally. Wall-of-text posts get skipped.

Before (link in body):
> CI 빌드 시간을 60% 줄인 방법을 정리했습니다.
>
> 자세한 내용은 여기에서 확인하세요: https://blog.example.com/ci-optimization

After (link in comment):
> CI 빌드 시간을 60% 줄인 방법을 정리했습니다.
>
> (핵심 내용 전개)
>
> 전체 글은 첫 번째 댓글에 링크를 남겨두었습니다.

**Slack:**
- No algorithm to fight. Lead with context, then link directly.
- Keep it scannable: 3-5 lines max. Teammates skim, not read.
- Emoji reactions replace engagement metrics. Be concise.

Before (verbose Slack share):
> 안녕하세요 여러분, 오늘 블로그에 새 글을 올렸는데요. CI/CD 파이프라인 최적화에 관한 내용입니다. 시간 되실 때 읽어보시면 좋을 것 같습니다. 피드백도 환영합니다!

After (scannable Slack share):
> CI 빌드 18분 → 7분 줄인 과정 정리했습니다
> - 캐시 전략 변경이 가장 큰 효과
> - 병렬 실행으로 추가 30% 단축
> https://blog.example.com/ci-optimization

**Twitter/X:**
- Thread for technical depth. Single tweet for quick shares.
- First tweet is the hook. Must stand alone without thread context.
- Hashtags: 1-2 max. Overuse looks spammy to developer audiences.

**Newsletter:**
- Subject line is the primary hook. Preview text (first ~90 chars) is the secondary hook.
- Body intro should deliver value independently. Not just "click to read."
- "Read more" CTA button must be visually distinct.
