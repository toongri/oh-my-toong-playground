# Structure Review

## Role

Reviews structural composition based on teaser type. Verifies type-specific opening, value delivery, closing, and proportion balance.

## Process

### Step 1: Type-Specific Opening

CP7. Opening patterns by type:

| Type | Valid Opening Patterns |
|------|----------------------|
| Learning Journey | Declarative thesis ("X는 중요합니다"), Provocative question citing authority ("왜 마틴 파울러는 X라고 했을까요?") |
| Practical Tip | Contrarian/paradoxical claim ("가장 좋은 X 강의는 X 자체입니다"), Direct instruction |
| Announcement | Direct news statement ("X를 업데이트했습니다") |
| Industry Insight | Trend observation ("X 도구가 사랑받고 있습니다"), Industry pattern statement |

Universal anti-patterns (flag these regardless of type):
- "블로그에 글을 올렸습니다..." / "I wrote a blog post about..."
- "새 글을 확인해보세요..." / "Check out my new article..."
- "이번 포스트에서는..." / "In this post, I..."
- Generic opener with no specific claim, topic, or news

Above-the-fold test (LinkedIn):
Read only the first 140 characters. Does the reader know (a) what specific topic this is about, AND (b) why they should care (specific claim, number, or surprising angle)? If either is missing, the opening fails regardless of which type pattern it follows.

Before:
> 블로그에 동기화에 대한 글을 올렸습니다. 관심 있으시면 읽어보세요.

After (Learning Journey):
> 다들 동기화, 동기/비동기, 블로킹/논블로킹. 이것들을 정확하게 정의하고 예시를 들 수 있겠지만, 저는 그러지 못했습니다.

After (Practical Tip):
> 동기/비동기를 설명 못 하면 면접에서 떨어집니다. 3분이면 정리됩니다.

### Step 2: Type-Specific Value Delivery

CP8. Value delivery by type:

| Type | Value Mode | Format | Key Principle |
|------|-----------|--------|--------------|
| Learning Journey | Narrative journey -- the story of learning IS the value | Prose paragraphs. Book/reference lists. | Reader gains insight from the author's process of discovery |
| Practical Tip | Specific instructions -- the technique IS the value | Numbered steps or short, direct paragraphs | Reader gets an immediately applicable method |
| Announcement | Feature descriptions -- what's new IS the value | Numbered items with context per feature | Reader understands what changed and why it matters |
| Industry Insight | Analysis and pattern identification | Timeline, comparisons, "what changed vs what didn't" | Reader gains a new lens for understanding the industry |

**Best practice: pair narrative with scannable elements.** LinkedIn formatted posts get significantly more engagement. For Learning Journey type, the narrative journey IS the core value — but adding 2-3 key takeaway bullets alongside the narrative improves scannability without destroying the story. Pure narrative without scannable elements is a Suggestion-level issue. Pure bullet takeaways without narrative context strip the Learning Journey of its defining characteristic and should be flagged as a type mismatch.

Anti-patterns (still flag these):
- Vague teasers: "X에 대한 제 생각을 공유합니다" (no specific insight)
- Table-of-contents style: "1장에서는... 2장에서는..." (chapter listing, not value)
- Promise without preview: "놀라운 결과가 있었습니다" without stating the result

Before (vague Learning Journey):
> 요구사항 작성에 대한 책을 읽었습니다. 좋은 내용이 많았습니다. 정리해봤습니다.

After (proper Learning Journey):
> 루퍼스 교육 과정에서 요구사항을 작성하는 과제를 하게 되었습니다. 그런데 정작 '요구사항을 어떻게 작성해야 하는지' 전혀 모르고 있다는 사실을 깨달았습니다. 그래서 관련 서적들을 찾아 읽었습니다.

### Step 3: Type-Specific Closing

CP9. Closing patterns by type:

| Type | Valid Closing | Example |
|------|-------------|---------|
| Learning Journey | Reflective continuation + embedded link (when promoting an article) | "이제 요구사항 공학의 첫걸음을 뗐으니, 더 깊이 파고 들어가야겠습니다" |
| Practical Tip | Call to try + optional link | "연휴 끝나면 출발선에 서 있을 겁니다" |
| Announcement | Link to resource + broader context | "이 스킬들은 plugins-for-claude-natives에서 공개해 두었습니다. [link]" |
| Industry Insight | Memorable thesis statement | "More tokens, more wins" |

Key principles:
- When the post promotes a blog article, a clear path to the full content is **required** (not optional). This is the post's primary conversion goal.
- Narrative-embedded links ("여기 정리해봤습니다") are preferred for Learning Journey and Industry Insight types — they feel less promotional.
- Explicit CTAs ("전체 글은 첫 댓글에") are natural for Practical Tip and Announcement types.
- Reflective closings without any link are valid ONLY for posts that don't promote a specific article (e.g., pure Industry Insight or opinion).

Anti-pattern:
- "좋아요와 공유 부탁드립니다!" (engagement begging)
- No link or CTA at all when the post IS promoting a blog article

Before (engagement begging):
> 동기화에 대해 정리해봤습니다.
>
> 전체 글은 여기서 확인하세요! [link]
>
> 좋아요와 공유 부탁드립니다!

After (clean CTA):
> 동기화에 대해 정리해봤습니다.
>
> 전체 과정은 첫 댓글 링크에서 확인하세요.

### Step 4: Structure Proportion

CP10. Proportion by type:

| Type | Opening | Body | Closing |
|------|---------|------|---------|
| Learning Journey | Thesis 10-15% | Confession + journey 55-65% | Reflection + link 20-30% |
| Practical Tip | Claim 15-20% | Instructions + evidence 60-70% | Action + result 10-20% |
| Announcement | News 10-15% | Features + context 65-75% | Link + significance 10-20% |
| Industry Insight | Observation 15-20% | Analysis + timeline 60-70% | Insight 10-20% |

Note: These are guidelines, not hard limits. The proportions will naturally vary. Flag only extreme imbalances (e.g., 80% opening and 0% body).
