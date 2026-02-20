# Structure Review

## Role

Reviews the structural composition of teaser text. Verifies hook presence and quality, value delivery through takeaways, CTA appropriateness, and overall proportion balance.

## Process

### Step 1: Hook Presence and Quality

**CP4. Hook presence and quality:**

First 1-2 lines must stop the scroll. The hook determines whether anyone reads the rest.

Effective hook patterns for developers:

| Pattern | Example |
|---------|---------|
| Statistic/quantifier | "12%의 엔지니어만 이 방법을 쓰고 있습니다..." |
| Contrarian | "우리가 [X]에 대해 잘못 알고 있었습니다." |
| Pain point | "모든 개발자가 결국 이 벽에 부딪힙니다..." |
| Result | "CI 시간을 60% 줄였습니다. 변경한 건 딱 하나." |

Anti-patterns (flag these):
- Starting with "I wrote a blog post about..." / "블로그에 글을 올렸습니다..."
- Starting with "Check out my new article..." / "새 글을 확인해보세요..."
- Starting with "In this post, I..." / "이번 포스트에서는..."
- Generic opener with no specific claim or tension

Before:
> 블로그에 CI/CD 최적화에 대한 글을 올렸습니다. 관심 있으시면 읽어보세요.

After:
> CI 빌드 18분 → 7분. 캐시 전략 하나 바꿨을 뿐입니다.

Before:
> 새 블로그 포스트를 작성했는데요, Kubernetes 모니터링에 대한 내용입니다.

After:
> 프로덕션 장애의 70%는 모니터링 사각지대에서 발생합니다. 우리 팀이 Kubernetes 모니터링 사각지대를 없앤 3가지 방법.

### Step 2: Value Delivery (Takeaways)

**CP5. Value delivery (takeaways):**

Must extract 2-4 concrete takeaways from the blog post. Each takeaway must be independently valuable: the reader learns something even without clicking the link.

Requirements:
- Numbered lists or bullet points preferred for scannability
- Each point delivers a specific insight, not a vague teaser
- Takeaways should make the reader think "I need to read the full post for details"

Anti-patterns:
- Vague teasers: "X에 대한 제 생각을 공유합니다" / "I share my thoughts on X"
- Table-of-contents style: "1장에서는... 2장에서는..."
- Promise without preview: "놀라운 결과가 있었습니다" without stating the result

Before:
> Kubernetes 모니터링에 대한 글을 썼습니다.
> - 모니터링이 중요한 이유
> - 우리 팀의 경험
> - 앞으로의 방향

After:
> Kubernetes 모니터링 사각지대를 없앤 3가지 방법:
> 1. Node-level 메트릭만 보면 Pod OOM은 못 잡는다 → cAdvisor 커스텀 알림 추가
> 2. Readiness probe 실패는 로그에 안 남는다 → Event Exporter 도입
> 3. HPA 스케일링 지연의 원인은 metrics-server 주기 → 15s로 조정

### Step 3: CTA Appropriateness

**CP6. CTA appropriateness by platform:**

| Platform | Recommended CTA | Anti-pattern |
|----------|-----------------|--------------|
| LinkedIn | "Link in comments" / "전체 글은 첫 댓글에" | Raw URL in post body |
| Slack | Direct link, no CTA fluff | "Please take a moment to read..." |
| Twitter/X | "Thread below" or link at end | "Click here to learn more!" |
| Newsletter | "Read the full post" with clear button/link | No CTA at all |

Before (LinkedIn):
> 전체 글은 여기서 확인하세요: https://blog.example.com/post

After (LinkedIn):
> 전체 과정이 궁금하시면 첫 번째 댓글에 링크 남겨두었습니다.

Before (Slack):
> 시간 나실 때 읽어보시면 좋을 것 같습니다. 피드백도 환영합니다!

After (Slack):
> https://blog.example.com/post

### Step 4: Hook-Value-CTA Proportion

**CP7. Hook-Value-CTA proportion:**

| Section | Target Proportion | Purpose |
|---------|-------------------|---------|
| Hook | 10-20% | Stop the scroll, create tension |
| Value | 60-70% | Deliver takeaways, build credibility |
| CTA | 10-20% | Direct to full content |

Anti-patterns:
- All hook, no value: Creates curiosity but delivers nothing. Reader feels baited.
- All CTA, no substance: "Read my post! Link below!" with no reason to click.
- No hook, straight to value: Informative but invisible. Nobody stops to read it.

Before (all hook, no value):
> 우리 팀의 CI 빌드 시간이 너무 느렸습니다. 정말 답답했죠. 매번 18분을 기다려야 했으니까요. 이 문제를 어떻게 해결했을까요? 블로그에 정리했습니다. 링크는 댓글에!

After (balanced):
> CI 빌드 18분 → 7분. (Hook: 10%)
>
> 핵심 변경 3가지:
> 1. Docker layer 캐시 전략을 remote cache로 전환
> 2. 테스트를 변경 파일 기반으로 필터링
> 3. 불필요한 lint 스텝을 pre-commit으로 이동
>
> (Value: 70%)
>
> 전체 과정과 삽질 기록은 첫 댓글 링크에. (CTA: 20%)
