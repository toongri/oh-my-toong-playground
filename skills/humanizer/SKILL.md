---
name: humanizer
description: Use when editing text to remove AI writing traces or improve naturalness in Korean or English. Triggers: "humanize", "AI 흔적 제거", "사람답게", "자연스럽게 고쳐", "de-AI", "remove AI patterns"
---

# Humanizer: AI Writing Pattern Detection & Correction

An editing tool that detects traces of AI-generated text and transforms them into natural human writing. Supports Korean (primary) and English. Based on Wikipedia's "Signs of AI writing" guide and Korean AI writing pattern research, detecting 35+ patterns.

## Quick Reference Cheatsheet

Scan this list FIRST during pattern detection. This cheatsheet is SUFFICIENT FOR DETECTION of every pattern; replacement guidance for each pattern code lives in the on-demand reference files (see the routing triggers after Step 3). K17/K18 replacement guidance is inline under `## Always-On Critical Patterns`.

### Korean patterns

| Code | Detection cue | Severity |
|------|---------------|----------|
| K1 | Opening clichés: "오늘날", "현대 사회에서", "급변하는 시대에", "디지털 시대에 접어들면서", "4차 산업혁명 시대", "~에 대해 알아보겠습니다", "~에 대해 살펴보겠습니다", "~를 함께 알아볼까요?", "~에 대해 깊이 파헤쳐 보겠습니다", "이번 글에서는" | P1 |
| K2 | Exaggerated modifiers: "혁신적인", "획기적인", "체계적인", "효과적인", "효율적인", "다양한"(2+/para), "풍부한", "탁월한", "놀라운", "뛰어난", "독보적인", "선도적인", "차별화된", "의미 있는", "가치 있는", "핵심적인", "필수적인", "지속 가능한" | P1 |
| K3 | Hedging endings: "~라고 할 수 있습니다", "~라고 볼 수 있습니다", "~라고 해도 과언이 아닙니다", "~것으로 보입니다", "~것으로 판단됩니다", "~것으로 예상됩니다", "~에 해당한다고 볼 수 있습니다" | P1 |
| K4 | "이를 통해" chaining: "이를 통해", "이를 바탕으로", "이를 기반으로", "이러한 관점에서", "이러한 측면에서", "이를 활용하여", "이와 같은 방식으로" | P1 |
| K5 | Empty importance claims: "중요성은 아무리 강조해도", "~은/는 매우 중요합니다", "핵심적인 역할", "~에 있어서 필수적", "중요성이 날로 커지고", "관심이 높아지고" | P1 |
| K6 | "~뿐만 아니라 ~도", "~뿐 아니라 ~까지", "단순히 ~하는 것을 넘어", "~에 그치지 않고" | P2 |
| K7 | "그렇다면" self-Q&A: "그렇다면 왜 ~일까요?", "그렇다면 어떻게 해야 할까요?", "그렇다면 ~란 무엇일까요?", "과연 ~일까요?" | P2 |
| K8 | Rule of Three: "A, B, 그리고 C", "첫째... 둘째... 셋째...", "A할 뿐만 아니라 B하며 C합니다" | P2 |
| K9 | Formality overuse + "~에 있어서": "~하겠습니다", "~되겠습니다", "~것입니다", "~하시기 바랍니다", "~에 해당합니다", "~에 있어서", "~에 있어", "~함에 있어" | P2 |
| K10 | Closing clichés: "결론적으로", "요약하자면", "마무리하며", "지금까지 ~에 대해 알아보았습니다", "앞으로 ~이/가 기대됩니다", "~의 발전이 기대됩니다", "함께 만들어 나가야 할 것입니다", "지속적인 관심이 필요합니다" | P1 |
| K11 | Chatbot residue: "도움이 되셨길 바랍니다", "궁금한 점이 있으시면", "더 자세한 내용이 필요하시면", "좋은 질문입니다!", "물론입니다!", "말씀하신 것처럼" | P1 |
| K12 | Meaningless conjunctive adverbs: "또한"(overuse), "한편", "더불어", "아울러", "나아가", "특히"(overuse), "무엇보다", "이에 따라", "따라서"(no logical context) | P2 |
| K13 | Pros/cons symmetry: "장점으로는... 단점으로는...", "물론... 하지만...", "한편으로는... 다른 한편으로는...", "긍정적인 측면... 부정적인 측면..." | P2 |
| K14 | Double passive: "~되어지다", "작성되어질 수 있습니다", "진행되어지고 있습니다", "사용되어질 수 있는", "변경되어지는" | P2 |
| K15 | "위해" overuse: "~를 위해", "~하기 위해", "~를 위한" (2+/para) | P2 |
| K16 | Sino-Korean overuse: "활용하다", "수행하다", "구축하다", "도입하다", "적용하다", "진행하다", "제공하다" (blog/essay only) | P3 |
| K17 | **any** em-dash (—) in Korean text | **P1** |
| K18 | **any** middle-dot (·) occurrence — including "남·녀", "동·서양" | **P1** |
| K19 | "이것이 X의 핵심이다" / "이것이 X다" / "이것이 X의 본질이다" / "이것이 ~의 핵심 역할이다" definition-closing translated from "This is the X" | P2 |
| K20 | mid-paragraph `>` blockquote inserted only to define a term | P2 |
| K21 | 100% consistent Korean(English) bilingual notation across the document | P2 |

### English patterns

| Code | Detection cue | Severity |
|------|---------------|----------|
| E1 | Importance inflation: testament, pivotal, crucial/vital role/moment, evolving landscape, indelible mark, stands/serves as, marks a shift, key turning point, underscores/highlights its importance, setting the stage for | P1 |
| E2 | Notability/media name-dropping: independent coverage, local/regional/national media outlets, leading expert, active social media presence | P1 |
| E3 | -ing suffix analysis: highlighting..., underscoring..., emphasizing..., ensuring..., reflecting/symbolizing..., contributing to..., cultivating/fostering..., showcasing... | P1 |
| E4 | Promotional language: nestled, groundbreaking, vibrant, robust, seamless, leverage, boasts, in the heart of, breathtaking, must-visit, stunning, cutting-edge, state-of-the-art, game-changing, rich (figurative), profound, showcasing, exemplifies, commitment to, renowned, streamline | P1 |
| E5 | Vague sourcing / weasel words: Industry reports, Observers have cited, Experts argue, Some critics argue, several sources | P1 |
| E6 | "Challenges and Future Prospects" formula: Despite its... faces challenges..., Despite these challenges, Future Outlook | P1 |
| E7 | AI-frequent vocabulary: Additionally, align with, delve, emphasizing, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), multifaceted, nuanced, paradigm, pivotal, realm, showcase, synergy, tapestry, testament, underscore, vibrant | P1 |
| E8 | Copula avoidance: serves as [a], stands as [a], marks [a], represents [a], boasts [a], features [a], offers [a] | P2 |
| E9 | Negative parallel structure: Not only...but..., It's not just about..., it's..., It's not merely..., it's... | P2 |
| E10 | False ranges: from X to Y / from A to B (when not a meaningful scale) | P2 |
| E11 | Em dash overuse (—) in sales-copy style (>1 per paragraph) | P2 |
| E12 | Bold overuse / inline header lists: mechanical bold on key terms, repeated `- **Header:** Description` pattern | P2 |
| E13 | Conversation residue / flattery / recent clichés: Great question!, That's an excellent point!, Of course!, Certainly!, Absolutely!, You're absolutely right!, Would you like..., let me know, here is a..., I hope this helps, Let's dive in, Let's break this down, Here's the thing, This is where X comes in, It's worth noting that, The key takeaway here is, At the end of the day, In a world where..., Here's the reality:, The bottom line: | P1 |
| E14 | Filler phrases: In order to, Due to the fact that, At this point in time, In the event that, has the ability to, It is important to note that, It goes without saying that | P2 |
| E15 | Excessive hedging: could potentially possibly, might have some | P2 |
| E16 | curly quotes ("\u201c...\u201d") → straight quotes ("...") | P3 |
| E17 | Title Case In Headings → sentence case | P3 |
| E18 | `*italic*` asterisk emphasis used in Korean text (Korean uses **bold**) | P3 |

### Common patterns (Korean + English)

| Code | Detection cue | Severity |
|------|---------------|----------|
| C1 | Synonym cycling (Elegant Variation): same referent renamed repeatedly to avoid repetition | P2 |
| C2 | Knowledge cutoff disclaimers: "정확한 정보는 확인이 필요합니다", "최신 정보와 다를 수 있습니다", "as of [date]", "Up to my last training update", "based on available information" | P1 |
| C3 | Positive conclusion formula: "밝은 미래가 기대됩니다", "무한한 가능성이 열려 있습니다", "함께 노력해야 할 것입니다", "The future looks bright", "Exciting times lie ahead", "a major step in the right direction" | P1 |
| C4 | Emoji decoration on headings or list items | P1 |
| C5 | Uniform paragraph length (all paragraphs mechanically 3-4 sentences) | P2 |
| C6 | Forced three-part structure (Introduction → Body → Conclusion regardless of text type) | P2 |
| C7 | tables used where prose would fit (qualitative misuse) | **P1** |
| C8 | "한 줄 요약 → 본문 → 헷갈렸던 지점 → 참고자료" / "TL;DR → Body → Pitfalls → References" lecture-slide closure | P2 |
| C9 | uniform tone/tension/sentence-length throughout — no fatigue toward the end | P2 |

**Note on markup & structure traces (K17–K21, E18, C7–C9):** these are not single-word matches — scan for whole-document layout signals, not just keyword hits.

---

## Execution Process

### Step 0: Determine Mode

Confirm the mode with the user. Default to **rewrite** if not specified.

| Mode | Description |
|------|-------------|
| **audit** | Detect patterns and output report only. Do NOT modify the text |
| **rewrite** | Detect patterns AND directly edit the text |

### Step 1: Confirm Input

- If user provides text directly, use as-is
- If user provides a file path, use Read to load it
- If user provides a glob pattern, use Glob → Read for multiple files

### Step 2: Identify Content Type

Content type determines which rules apply. **This step is MANDATORY — do NOT skip it.**

| Type | Application criteria | "Soul injection" |
|------|---------------------|-----------------|
| **Blog/Essay** | Apply all patterns | YES — opinions, 1st person, personality strongly encouraged |
| **Technical docs** | Clarity first. Remove modifiers/filler. **STRICT fact rule: do NOT add examples, numbers, or specifics not in the original. When removing vague modifiers like "다양한 플랫폼", replace with neutral phrasing ("여러 플랫폼") or simply delete — never substitute with concrete names (Google, GitHub, etc.) that weren't in the source** | NO — no emotion/personality. Precise and dry |
| **Marketing/Copy** | Reduce exaggeration but maintain persuasion. Replace with concrete numbers **only if they exist in the source**; otherwise remove the vague claim | LIMITED — match brand voice |
| **Academic/Report** | Accuracy and citations first. Remove weasel words | NO — maintain objective tone |
| **Code comments** | Brevity first. Remove unnecessary explanation | NO |
| **SNS/Casual** | Remove excessive formality. Colloquial OK | YES — freely |

### Step 3: Pattern Scan

Scan the entire text against the Quick Reference Cheatsheet above. Assign severity to each detection:

- **P1 (Definite AI trace)** — Patterns humans almost never use. Fix immediately
- **P2 (Suspicious pattern)** — AI uses frequently but humans sometimes use too. Requires contextual judgment
- **P3 (Style improvement)** — More about quality than AI traces

**CRITICAL: Context-Sensitive Detection Rules**

Do NOT mechanically keyword-match. Apply these judgment rules:

| Situation | Correct action | Example |
|-----------|---------------|---------|
| K2 word used once, followed by specific examples | Do NOT flag | "다양한 워크로드를 관리한다. 스테이트풀셋, 데몬셋..." — "다양한" is justified |
| K2 word used regardless of positive/negative context | ALWAYS flag P1 | "혁신적인 기술 도입보다는..." — "혁신적인" is still P1 even in negative framing |
| K5-like "중요하다" followed by concrete evidence | Do NOT flag | "이 문제는 중요하다. 장애의 40%가..." — importance backed by data |
| K5 "중요하다" with no supporting evidence | Flag P1 | "테스트는 매우 중요합니다" — empty emphasis |
| K12 접속부사 used once, logically connecting topics | Do NOT flag | Single "또한" bridging genuinely related points |
| K12 접속부사 used 3+ times in short text | Flag P2 | "또한... 더불어... 나아가..." chain |
| K2 "다양한" used 2+ times in one paragraph | Flag P1 | "다양한 기능... 다양한 환경... 다양한 용도" |

### Routing Triggers — read the matching reference file BEFORE Step 4

After the pattern scan, fetch replacement guidance on demand. The cheatsheet is enough to DETECT; the reference files hold the REPLACEMENT recipes (before/after, rules) for the flagged codes.

- If content type is **Blog/Essay** or **SNS/Casual** → read `soul-injection.md` before Step 4 (soul injection guidance; do NOT apply to technical/academic/code).
- For any flagged **K1–K16 / K19–K21** pattern → read `patterns-korean.md`.
- For any flagged **E1–E18** pattern → read `patterns-english.md`.
- For any flagged **C1–C9** pattern → read `patterns-common.md`.
- If a worked before/after example or the source references are needed → read `examples.md`.

K17 (em-dash) and K18 (middle-dot) replacement guidance is already inline below under `## Always-On Critical Patterns` — no file read needed for those.

### Step 4: Edit (rewrite mode only)

- **P1: Fix unconditionally**
- **P2: Use contextual judgment, lean toward fixing when uncertain**
- **P3: Fix selectively to match overall tone**

**Non-negotiable rewrite rules:**
1. **NEVER distort the core meaning of the original**
2. **Preserve the existing tone (formal/informal) of the text**
3. **NEVER fabricate facts not present in the original.** When replacing empty modifiers with specifics, ONLY use data that exists in the source text. If no data exists, simply remove the empty modifier — that is sufficient. **Distinction for soul injection (Blog/Essay only):** Personal observations and general-knowledge context ("출퇴근 왕복 1-2시간") are acceptable as 1st-person perspective, but NEVER present them as cited statistics or attributed research
4. **Preserve ALL numbers, statistics, source attributions, and proper nouns exactly**

### Step 5: Output Results

**Audit mode output format:**

```
## Detection Report

Total detections: N (P1: n, P2: n, P3: n)

| # | Location | Severity | Pattern | Original | Suggestion |
|---|----------|----------|---------|----------|------------|
| 1 | L3       | P1       | K2 Exaggerated modifier | "혁신적인 방법론을 통해" | "이 방법으로" |
```

**Rewrite mode output:**
Full rewritten text + change summary listing all applied pattern codes.

---

## Always-On Critical Patterns

> K17 and K18 fire on essentially every Korean invocation, so their full replacement guidance stays inline (not deferred). Detection cues are also in the cheatsheet above.

### K17. Em-dash (—) in Korean — any occurrence [P1]

**Detection signal:** Any em-dash (—) appearing in a Korean text, especially when used as English-style appositive ("~다 — 이것이 ~의 핵심이다") rather than as a range marker.

**Problem:** Korean writers natively use colon(:), parentheses, or line breaks for parenthetical exposition. Em-dash use in running Korean prose is a residue from English-trained models copying English typographic habits. Like K18 (middle-dot), em-dash belongs to narrow registers (newspaper headlines, range notation) — its appearance in blog/study-note prose is the signal, not the count.

**Severity rule:** Em-dash (—) appears anywhere in Korean prose → **P1**. No threshold counting, no grading.

**Replacements:**
- `~다 — 이것이 X의 핵심이다.` → `~다. 이것이 X의 핵심이다.` (period + new sentence) or simply delete the second clause if redundant
- `A — B` (appositive) → `A(B)` or `A. B는 ~`
- `A — 그래서 B` → `A. 그래서 B` or `A이고, 그래서 B`

**Before:**
> 메시지 전달이지만 영속성·보장 수준·소비자 모델이 다르다. — 이런 식의 부연이 한국어 글에 어울리지 않는다.

**After:**
> 메시지 전달이지만 영속성, 보장 수준, 소비자 모델이 다르다. 이런 식의 부연은 한국어 글에 잘 안 어울린다.

---

### K18. Middle-dot (·) — any occurrence [P1]

**Detection signal:** Any middle-dot (·) character used as a separator in the text — enumeration, compound nouns, or paired terms. "A·B·C", "영속성·보장 수준·소비자 모델", "큐·스트림·이벤트 버스", "남·녀", "동·서양", "국·공립".

**Why this matters:** Korean writers in any normal register — blog, study notes, technical writing, essay, SNS — **do not use middle-dot in running prose**. Even traditionally hyphenated pairs ("남녀", "동서양", "국공립") are written without the middle dot in everyday text. Middle dot is corpus-specific punctuation belonging to newspaper headlines, government documents, Wikipedia, and academic publication metadata — exactly the kind of text overrepresented in LLM training data. **Any middle-dot occurrence is a definitive AI signature.**

**Severity rule:**
- Middle-dot (·) appears anywhere in the text → **P1**. No exceptions. No grading by context.

**Rule for rewrite:**
- `A·B·C` → `A, B, C` or `A와 B, 그리고 C`
- `영속성·보장 수준·소비자 모델` → `영속성과 보장 수준, 소비자 모델` (split into a clause)
- `남·녀`, `동·서양`, `국·공립` → `남녀`, `동서양`, `국공립` (drop the dot, fuse)
- If the middle-dot list is also followed by em-dash, additionally apply K17

**Before:**
> 메시지 전달이지만 영속성·보장 수준·소비자 모델이 다르다 — 그래서 큐는 1:1, 스트림은 n:n에 어울린다.

**After:**
> 메시지를 전달하는 도구지만 영속성, 보장 수준, 소비자 모델이 각각 다르다. 그래서 큐는 1:1 작업 분배에, 스트림은 n:n 분배에 어울린다.

**Before:**
> 이번 글에서는 큐·스트림·이벤트 버스를 비교한다.

**After:**
> 이번 글에서는 큐, 스트림, 이벤트 버스를 비교한다.

**Note on edge cases:** If you are intentionally humanizing newspaper-style copy, government documents, or academic abstracts where middle dot is a register convention, this rule may produce false positives. In that case, the humanization itself is likely inappropriate for the source register — middle dot is not the only signal that will fire.

---

## Reference Files (on-demand)

Replacement guidance is relocated to colocated files, read on demand per the routing triggers after Step 3. Detection stays inline (cheatsheet); these hold replacement recipes only.

| File | Contents | Read when |
|------|----------|-----------|
| `soul-injection.md` | "Breathing Life Into Writing" — soul-injection guidance | Content type is Blog/Essay or SNS/Casual |
| `patterns-korean.md` | K1–K16, K19–K21 replacement recipes | Any K1–K16 / K19–K21 pattern flagged |
| `patterns-english.md` | E1–E18 replacement recipes | Any E1–E18 pattern flagged |
| `patterns-common.md` | C1–C9 replacement recipes | Any C1–C9 pattern flagged |
| `examples.md` | Full before/after worked example + References | A worked example or the source references are needed |
