# Type Classification

## Role

Classifies teaser type, verifies required elements per type, and checks platform constraints.

## 4 Teaser Types

| Type | Author State | Core Pattern | Core Question |
|------|-------------|--------------|---------------|
| Learning Journey | Studied something new, processed it | Thesis → Confession → Journey → Reflection | "이걸 공부하면서 뭘 깨달았지?" |
| Practical Tip | Found a specific useful technique | Claim → Evidence → Instruction | "이 방법을 어떻게 알려주지?" |
| Announcement | Built/released something new | News → Features → Link | "이걸 어떻게 소개하지?" |
| Industry Insight | Observed a trend, formed a view | Observation → Analysis → Insight | "이 흐름에서 뭘 읽어내지?" |

## Process

### Step 1: Type Classification

CP1. Type classification criteria:
- Personal learning story, book references, "깨달았다/몰랐다" → Learning Journey
- Specific technique, how-to instructions, "이렇게 하세요" → Practical Tip
- New release, feature list, update announcement → Announcement
- Trend analysis, timeline progression, industry observation → Industry Insight
- Hybrid types allowed: Learning Journey + Industry Insight, etc.

### Step 2: Verify Required Elements by Type

#### CP2. Learning Journey Required Elements

1. Declarative thesis opening (establishes topic importance)
2. Personal gap confession (admits what the author didn't know)
3. Learning process description (books read, experiments done, mentors consulted)
4. Referenced authorities (book titles, expert names, specific concepts)
5. Reflective closing (forward-looking, "the learning continues")
6. Blog link embedded naturally in narrative (if present)

Example (from actual LinkedIn post):

> 올바른 설계를 위해서는, 먼저 적절한 요구사항을 작성하는 것이 중요합니다. 그리고 이렇게 작성된 요구사항은 그 자체로도 훌륭한 산출물이 되죠.
>
> 루퍼스 교육 과정에서 설계를 위한 요구사항과 다양한 다이어그램을 작성하는 과제를 하게 되었습니다. 그런데 정작 '요구사항을 어떻게 작성해야 하는지' 전혀 모르고 있다는 사실을 깨달았습니다. 심지어 내가 무엇을 모르는지도 모르는 상태였죠.
>
> 그래서 관련 서적들을 찾아 읽었습니다:
> - Software Requirement Essentials (Karl Wiegers 외, 2023)
> - Software Requirements 3 (Karl Wiegers 외, 2013)
> - User Stories Applied (Mike Cohn, 2004)
> - Writing Effective Use Cases (Alistair Cockburn, 2001)
>
> 독후감을 겸해 읽은 내용을 정리해보았습니다.
> [link]
>
> 이제 요구사항 공학의 첫걸음을 뗐으니, 더 깊이 파고 들어가야겠습니다.

Notes:
1. Thesis: "올바른 설계를 위해서는, 먼저 적절한 요구사항을 작성하는 것이 중요합니다"
2. Confession: "정작 '요구사항을 어떻게 작성해야 하는지' 전혀 모르고 있다는 사실을 깨달았습니다"
3. Learning process: 4 books listed
4. Authority: Karl Wiegers, Mike Cohn, Alistair Cockburn
5. Reflective closing: "이제 요구사항 공학의 첫걸음을 뗐으니, 더 깊이 파고 들어가야겠습니다"
6. Link embedded: "독후감을 겸해 읽은 내용을 정리해보았습니다."

#### CP3. Practical Tip Required Elements

1. Contrarian or paradoxical claim opening
2. Specific, actionable instructions or concrete method
3. Expected result or outcome
4. Optional: Authority reference for credibility

Example:

> 가장 좋은 Claude Code 강의는 Claude Code 자체입니다. 침대에 누워서 유튜브를 틀지 마세요. 영상을 보면 "아 그렇구나"로 끝나고, 터미널을 열고 직접 대화하면 3일이면 출발선에 설 수 있습니다.
>
> [specific CLAUDE.md configuration instructions]
>
> 조카 세뱃돈 준 셈치고 Max 플랜 결제해보세요. 그리고 터미널에 이렇게 입력하세요. "공식 문서 읽고 나한테 Claude Code를 순서대로 가르쳐줘."
>
> 연휴 끝나면 출발선에 서 있을 겁니다.

Notes:
1. Paradoxical claim: "가장 좋은 Claude Code 강의는 Claude Code 자체입니다"
2. Specific instructions: exact CLAUDE.md text to add, exact command to type
3. Expected result: "연휴 끝나면 출발선에 서 있을 겁니다"

#### CP4. Announcement Required Elements

1. Direct news statement (what's new)
2. Numbered feature/change descriptions with context for each
3. Use case or motivation per feature
4. Link to the resource
5. Optional: Broader significance or origin story

Example:

> /clarify 스킬을 업데이트했습니다. metamedium, unknown라는 프레임워크를 기반으로 총 3가지 스킬로 만들어두었어요.
>
> 1. clarify:unknown - 전략 맹점 찾기
> [description with framework explanation]
>
> 2. clarify:metamedium - 내용 vs 형식
> [description with concept explanation]
>
> 3. clarify:vague - 요구사항 명확화
> [description with use case]
>
> 이 스킬들은 plugins-for-claude-natives의 clarify 플러그인으로 공개해 두었습니다. [link]

Notes:
1. Direct news: "/clarify 스킬을 업데이트했습니다"
2. Numbered features: 3 items with framework names and descriptions
3. Context per feature: Each has a "why this exists" explanation
4. Link: at the end, directing to the resource

#### CP5. Industry Insight Required Elements

1. Trend observation opening (what's happening in the industry)
2. Timeline or progression analysis (how things evolved)
3. Underlying pattern identification (what stays constant, what changes)
4. Forward-looking insight or thesis
5. Memorable closing statement

Example:

> 더 많은 사람에게 토큰을 더 많이 쓰게 해주는 도구가 사랑받고 있습니다. Claude Code -> oh my opencode -> Pencil로 넘어갑니다.
>
> [4-stage timeline: Multi Clauding → Skills → Plugin → Pencil]
>
> 여기서 변한 건 AI를 쓰는 방식이에요. Claude Code -> Skills -> Plugin -> SDK. 이런 걸 Harness라고도 하죠. 계속 정교해지고 있어요.
> 변하지 않는 건 max 구독이에요. $200를 구독해야 토큰을 최대한으로 할인받거든요.
>
> More tokens, more wins

Notes:
1. Trend observation: "더 많은 사람에게 토큰을 더 많이 쓰게 해주는 도구가 사랑받고 있습니다"
2. Timeline: 4 numbered stages with descriptions
3. Pattern: "변한 건" (harness sophistication) vs "변하지 않는 건" (max subscription)
4. Closing: "More tokens, more wins"

### Step 3: Platform Constraint Compliance

CP6. Platform constraints:

| Platform | Max Length | Link Placement | Format |
|----------|-----------|----------------|--------|
| LinkedIn | 3000 chars (140 before fold) | Inline in narrative or first comment | Paragraph-based narrative |
| Slack | No hard limit (3-5 lines ideal) | Inline, upfront | TL;DR + bullets |
| Twitter/X | 280 chars (or thread) | End of thread | Single tweet or thread |
| Newsletter | ~100 words intro | "Read more" CTA button | Subject line + preview + body |

Key rules:
- LinkedIn: First 2 lines visible before fold. They don't need to be "hooks" -- declarative thesis statements work equally well.
- LinkedIn: Inline links in narrative ("여기 정리해봤습니다.") are a valid alternative to "link in comments". Both approaches work.
- Slack: No algorithm to fight. Lead with context, then link directly.
- Twitter/X: Thread for technical depth. First tweet must stand alone.
- Newsletter: Subject line is the primary hook. Preview text is secondary.

### Step 4: Type Mismatch Reporting

When the text's actual content doesn't match the expected type:
- Specify mismatch points between identified type and actual structure
- Suggest which type better fits, or list missing elements for the current type
