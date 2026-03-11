---
name: humanizer
description: Use when editing text to remove AI writing traces, when text sounds robotic or machine-generated, when reviewing Korean or English content for naturalness. Triggers include "humanize", "AI 흔적 제거", "사람답게", "자연스럽게 고쳐", "de-AI", "remove AI patterns"
---

# Humanizer: AI Writing Pattern Detection & Correction

An editing tool that detects traces of AI-generated text and transforms them into natural human writing. Supports Korean (primary) and English. Based on Wikipedia's "Signs of AI writing" guide and Korean AI writing pattern research, detecting 35+ patterns.

## Quick Reference Cheatsheet

Scan this list FIRST during pattern detection. See full catalog below for detailed guidance.

### Korean Immediate Fix (P1)

| Code | Detection keywords |
|------|--------------------|
| K1 | "오늘날", "알아보겠습니다", "살펴보겠습니다", "이번 글에서는" |
| K2 | "혁신적인", "획기적인", "체계적인", "효과적인", "다양한"(overuse), "탁월한" |
| K3 | "~라고 할 수 있습니다", "~라고 해도 과언이 아닙니다" |
| K4 | "이를 통해", "이를 바탕으로", "이를 활용하여" |
| K5 | "중요성은 아무리 강조해도", "핵심적인 역할", "관심이 높아지고" |
| K10 | "결론적으로", "지금까지 ~에 대해", "발전이 기대됩니다" |
| K11 | "도움이 되셨길", "궁금한 점이 있으시면", "좋은 질문입니다!" |

### English Immediate Fix (P1)

| Code | Detection keywords |
|------|--------------------|
| E1 | testament, pivotal, evolving landscape, indelible mark |
| E3 | highlighting..., underscoring..., showcasing..., fostering... |
| E4 | nestled, groundbreaking, vibrant, robust, seamless, leverage |
| E7 | Additionally, delve, tapestry, interplay, intricate |
| E13 | Great question!, I hope this helps, Let's dive in, Here's the thing |
| E16 | curly quotes ("\u201c...\u201d") → straight quotes ("...") |

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

Scan the entire text against the pattern catalog below. Assign severity to each detection:

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

## Breathing Life Into Writing

> **Applies ONLY to: Blog/Essay, SNS/Casual.** Do NOT apply to technical docs, academic, or code comments.

Removing AI patterns is half the job. Clean but lifeless writing still reads as AI.

### Signs of soulless writing:
- All sentences similar length and structure
- Facts listed without opinions
- No acknowledgment of uncertainty or complex feelings
- 1st person avoided even where appropriate
- No humor, sharpness, or personality
- Reads like a press release or encyclopedia

### How to breathe life in:

**Have an opinion.** Don't just report facts — react to them. "솔직히 이건 좀 애매하다" beats neutrally listing pros and cons.

**Vary the rhythm.** Short sentences. Then a longer one that takes its time. Mix them.

**Acknowledge complexity.** Humans have mixed feelings. "인상적인데 동시에 좀 불편하다" is more human than just "인상적이다".

**Use "I" when appropriate.** First person isn't unprofessional. "계속 생각나는 건..." and "내가 걸리는 부분은..." are expressions of a thinking person.

**Allow some messiness.** Perfect structure smells algorithmic. Tangents, asides, half-formed thoughts are human.

**Be specific with emotions.** Not "우려된다" but "새벽 3시에 아무도 안 보는데 에이전트가 혼자 돌아가는 거 생각하면 좀 소름 돋는다."

### Before (clean but soulless):
> 이 실험은 흥미로운 결과를 보여주었다. 에이전트가 300만 줄의 코드를 생성했다. 일부 개발자는 감명받았고 다른 개발자는 회의적이었다. 시사점은 아직 불분명하다.

### After (writing that breathes):
> 솔직히 이건 어떻게 받아들여야 할지 모르겠다. 300만 줄의 코드, 사람들이 자는 동안 생성됐다. 개발자 절반은 난리가 났고, 절반은 왜 의미 없는지 설명하느라 바쁘다. 진실은 아마 그 중간 어딘가 재미없는 곳에 있겠지만, 밤새 혼자 일하는 에이전트 생각이 자꾸 든다.

---

## Korean AI Pattern Catalog

### K1. Opening clichés [P1]

**Detection expressions:** "오늘날", "현대 사회에서", "급변하는 시대에", "디지털 시대에 접어들면서", "4차 산업혁명 시대", "~에 대해 알아보겠습니다", "~에 대해 살펴보겠습니다", "~를 함께 알아볼까요?", "~에 대해 깊이 파헤쳐 보겠습니다", "이번 글에서는"

**Problem:** AI reflexively sets the scene with era-framing or meta-descriptions when starting a piece.

**Before:**
> 오늘날 급변하는 디지털 시대에 접어들면서 인공지능 기술은 우리 삶의 다양한 영역에 걸쳐 혁신적인 변화를 가져오고 있습니다. 이번 글에서는 AI 코딩 도구에 대해 자세히 알아보겠습니다.

**After:**
> AI 코딩 도구가 실제로 생산성을 높이는지, 연구 결과를 보면 답이 간단하지 않다.

---

### K2. Exaggerated modifiers [P1]

**Detection expressions:** "혁신적인", "획기적인", "체계적인", "효과적인", "효율적인", "다양한" (2+ times per paragraph), "풍부한", "탁월한", "놀라운", "뛰어난", "독보적인", "선도적인", "차별화된", "의미 있는", "가치 있는", "핵심적인", "필수적인", "지속 가능한"

**Problem:** The most frequent pattern in Korean AI text. If removing the modifier doesn't change the meaning, it's inflation. "다양한" in particular is the single most common word in Korean AI text — it never specifies what exactly is diverse.

**IMPORTANT:** Flag these words as P1 regardless of context — even when used in negative framing (e.g., "혁신적인 기술 도입보다는..."). The word itself is an AI marker.

**Exception:** Single use of "다양한" followed immediately by specific examples (e.g., "다양한 워크로드: 스테이트풀셋, 데몬셋...") is acceptable — the specifics justify the modifier.

**Before:**
> 이 혁신적인 프레임워크는 다양한 기능을 제공하여 다양한 환경에서 다양한 용도로 활용할 수 있는 탁월한 도구입니다.

**After:**
> 이 프레임워크는 빌드, 테스트, 배포를 하나의 설정 파일로 관리한다. Node.js와 브라우저 양쪽에서 쓸 수 있다.

---

### K3. Hedging sentence endings [P1]

**Detection expressions:** "~라고 할 수 있습니다", "~라고 볼 수 있습니다", "~라고 해도 과언이 아닙니다", "~것으로 보입니다", "~것으로 판단됩니다", "~것으로 예상됩니다", "~에 해당한다고 볼 수 있습니다"

**Problem:** AI appends hedging endings to every sentence to avoid making definitive claims. When stating facts, be definitive.

**Before:**
> React는 현재 가장 널리 사용되는 프론트엔드 라이브러리라고 할 수 있습니다. 이는 컴포넌트 기반 아키텍처를 채택하고 있기 때문이라고 볼 수 있습니다.

**After:**
> React는 현재 가장 많이 쓰이는 프론트엔드 라이브러리다. 컴포넌트 단위로 UI를 쪼개서 재사용하는 구조 덕분이다.

---

### K4. "이를 통해" chaining [P1]

**Detection expressions:** "이를 통해", "이를 바탕으로", "이를 기반으로", "이러한 관점에서", "이러한 측면에서", "이를 활용하여", "이와 같은 방식으로"

**Problem:** AI mechanically chains sentences with "이를 통해" creating formulaic cause-and-effect links.

**Before:**
> 먼저 데이터를 수집합니다. 이를 통해 패턴을 분석할 수 있습니다. 이를 바탕으로 모델을 학습시킵니다. 이를 활용하여 예측을 수행합니다.

**After:**
> 데이터를 수집해서 패턴을 분석하고, 그 결과로 모델을 학습시킨 뒤 예측에 쓴다.

---

### K5. Empty importance claims [P1]

**Detection expressions:** "~의 중요성은 아무리 강조해도 지나치지 않습니다", "~은/는 매우 중요합니다", "~에서 핵심적인 역할을 합니다", "~에 있어서 필수적입니다", "~의 중요성이 날로 커지고 있습니다", "~에 대한 관심이 높아지고 있습니다"

**Problem:** Claims something is important without saying WHY with specifics.

**Context-sensitive rule:** If "중요하다" is immediately followed by concrete evidence (statistics, specific reasons), it is NOT K5. K5 only applies when importance is claimed without supporting evidence.

**Before:**
> 코드 리뷰의 중요성은 아무리 강조해도 지나치지 않습니다. 소프트웨어 개발에 있어서 코드 리뷰는 핵심적인 역할을 합니다.

**After:**
> 코드 리뷰를 거친 코드는 프로덕션 버그가 적다. 이유 중 하나는 리뷰어가 작성자가 놓친 엣지 케이스를 잡아내기 때문이다.

---

### K6. "~뿐만 아니라 ~도" overuse [P2]

**Detection expressions:** "~뿐만 아니라 ~도", "~뿐 아니라 ~까지", "단순히 ~하는 것을 넘어", "~에 그치지 않고"

**Problem:** Korean equivalent of "Not only...but also...". AI mechanically uses this for scope expansion.

**Before:**
> 이 도구는 코드 자동 완성뿐만 아니라 리팩토링, 테스트 생성, 문서화까지 지원합니다. 단순히 코드를 작성하는 것을 넘어 전체 개발 워크플로우를 혁신합니다.

**After:**
> 이 도구는 자동 완성, 리팩토링, 테스트 생성, 문서화를 지원한다.

---

### K7. "그렇다면" self-Q&A [P2]

**Detection expressions:** "그렇다면 왜 ~일까요?", "그렇다면 어떻게 해야 할까요?", "그렇다면 ~란 무엇일까요?", "과연 ~일까요?"

**Problem:** AI poses questions to itself for structure, especially in blog posts.

**Before:**
> 마이크로서비스 아키텍처가 주목받고 있습니다. 그렇다면 왜 마이크로서비스가 필요할까요? 그 이유는 크게 세 가지로 나눌 수 있습니다.

**After:**
> 마이크로서비스로 전환하는 이유는 보통 배포 독립성이다. 한 팀의 변경이 다른 팀을 막지 않는다.

---

### K8. Rule of Three [P2]

**Detection expressions:** "A, B, 그리고 C", "첫째... 둘째... 셋째...", "A할 뿐만 아니라 B하며 C합니다"

**Problem:** AI bundles items in threes to appear comprehensive. Fine if genuinely three, but suspicious when forced to fit three.

**Before:**
> 이 프레임워크는 확장성, 유연성, 그리고 안정성을 모두 갖추고 있습니다.

**After:**
> 이 프레임워크는 수평 스케일링을 지원하고, 플러그인 구조로 기능을 추가할 수 있다.

---

### K9. Formality overuse and "~에 있어서" [P2]

**Detection expressions:** "~하겠습니다", "~되겠습니다", "~것입니다", "~하시기 바랍니다", "~에 해당합니다", "~에 있어서", "~에 있어", "~함에 있어"

**Problem:** AI defaults to overly formal register. "~에 있어서" can almost always be omitted or replaced with a more direct expression.

**Note:** Judge by content type. Formal register is appropriate for official documents or presentations.

**Before:**
> 소프트웨어 개발에 있어서 테스트는 필수적입니다.

**After:**
> 테스트 없이 소프트웨어를 배포하면 문제가 터진다.

---

### K10. Closing clichés [P1]

**Detection expressions:** "결론적으로", "요약하자면", "마무리하며", "지금까지 ~에 대해 알아보았습니다", "앞으로 ~이/가 기대됩니다", "~의 발전이 기대됩니다", "함께 만들어 나가야 할 것입니다", "지속적인 관심이 필요합니다"

**Problem:** AI appends content-free hopeful outlooks at the end.

**Before:**
> 지금까지 컨테이너 기술에 대해 알아보았습니다. 앞으로 컨테이너 기술의 발전이 더욱 기대되며, 개발자들의 지속적인 관심이 필요합니다.

**After:**
> 컨테이너를 처음 쓴다면 Docker Desktop으로 시작해서, 프로덕션에서는 Kubernetes를 검토하면 된다.

---

### K11. Chatbot conversation residue [P1]

**Detection expressions:** "도움이 되셨길 바랍니다", "궁금한 점이 있으시면", "더 자세한 내용이 필요하시면", "좋은 질문입니다!", "물론입니다!", "말씀하신 것처럼"

**Problem:** Chatbot conversation traces remaining in written text. Delete all.

---

### K12. Meaningless conjunctive adverbs [P2]

**Detection expressions:** "또한" (overuse), "한편", "더불어", "아울러", "나아가", "특히" (overuse), "무엇보다", "이에 따라", "따라서" (without logical context)

**Problem:** Strings sentences together with conjunctive adverbs without actual logical connection.

**Context-sensitive rule:** A single "또한" or "특히" connecting genuinely related topics is acceptable. Flag only when:
- Same adverb appears 2+ times in short text
- Multiple different adverbs chain sentences without real logical progression
- The adverb bridges unrelated topics

**Before:**
> Rust는 메모리 안전성을 보장합니다. 또한 성능이 뛰어납니다. 더불어 동시성 처리도 강력합니다. 나아가 생태계도 빠르게 성장하고 있습니다.

**After:**
> Rust는 컴파일 타임에 메모리 안전성을 검증하면서도 C++ 수준의 성능을 낸다. 동시성 모델도 데이터 레이스를 컴파일러가 잡아준다.

---

### K13. Pros/cons symmetry structure [P2]

**Detection expressions:** "장점으로는... 단점으로는...", "물론... 하지만...", "한편으로는... 다른 한편으로는...", "긍정적인 측면... 부정적인 측면..."

**Problem:** AI mechanically balances both sides for appearance of objectivity.

**Before:**
> 물론 마이크로서비스에는 많은 장점이 있습니다. 하지만 단점도 존재합니다. 장점으로는 독립적 배포, 기술 다양성, 확장성이 있으며, 단점으로는 복잡성 증가, 네트워크 오버헤드, 데이터 일관성 문제가 있습니다.

**After:**
> 마이크로서비스의 최대 이점은 독립 배포다. 대신 서비스 간 통신이 복잡해지고, 분산 트랜잭션 처리가 골치 아파진다. 팀이 5명 이하라면 모놀리스가 거의 항상 낫다.

---

### K14. Unnecessary passive constructions [P2]

**Detection expressions:** "~되어지다" (double passive), "작성되어질 수 있습니다", "진행되어지고 있습니다", "사용되어질 수 있는", "변경되어지는"

**Problem:** Korean "~되다" is sufficient for passive, but AI adds "~어지다" creating double passive. Used to increase perceived politeness.

**Before:**
> 데이터가 수집되어지고 분석이 진행되어지면 결과가 도출되어질 수 있습니다.

**After:**
> 데이터를 수집하고 분석하면 결과가 나온다.

---

### K15. "위해" overuse [P2]

**Detection expressions:** "~를 위해", "~하기 위해", "~를 위한" (2+ times per paragraph)

**Problem:** AI repeats "위해" when expressing purpose.

**Before:**
> 성능을 향상시키기 위해 캐시를 도입했으며, 안정성을 확보하기 위해 재시도 로직을 추가했고, 가독성을 높이기 위해 코드를 리팩토링했습니다.

**After:**
> 캐시를 도입해 성능을 높이고, 재시도 로직으로 안정성을 잡았다. 겸사겸사 코드도 정리했다.

---

### K16. Sino-Korean word overuse [P3]

**Detection expressions:** "활용하다"→쓰다, "수행하다"→하다, "구축하다"→만들다/세우다, "도입하다"→넣다/쓰기 시작하다, "적용하다"→쓰다/붙이다, "진행하다"→하다, "제공하다"→주다/내놓다

**Problem:** AI prefers Sino-Korean words over simpler native Korean. Not always wrong, but creates stiffness outside technical docs.

**Note:** In technical docs, Sino-Korean may be more natural (e.g., "API를 활용하다" isn't worse than "API를 쓰다"). Apply mainly to blog/essay content.

---

## English AI Pattern Catalog

### E1. Importance inflation [P1]

**Detection expressions:** stands/serves as, is a testament/reminder, pivotal/crucial/vital role/moment, underscores/highlights its importance, reflects broader, symbolizing its enduring, setting the stage for, marks a shift, key turning point, evolving landscape, indelible mark

**Before:**
> The Statistical Institute of Catalonia was officially established in 1989, marking a pivotal moment in the evolution of regional statistics in Spain.

**After:**
> The Statistical Institute of Catalonia was established in 1989 to collect and publish regional statistics independently from Spain's national statistics office.

---

### E2. Notability/media name-dropping [P1]

**Detection expressions:** independent coverage, local/regional/national media outlets, leading expert, active social media presence

**Before:**
> Her views have been cited in The New York Times, BBC, Financial Times, and The Hindu. She maintains an active social media presence with over 500,000 followers.

**After:**
> In a 2024 New York Times interview, she argued that AI regulation should focus on outcomes rather than methods.

---

### E3. -ing suffix analysis [P1]

**Detection expressions:** highlighting/underscoring/emphasizing..., ensuring..., reflecting/symbolizing..., contributing to..., cultivating/fostering..., showcasing...

**Before:**
> The temple's color palette resonates with the region's natural beauty, symbolizing Texas bluebonnets, reflecting the community's deep connection to the land.

**After:**
> The temple uses blue, green, and gold. The architect said these reference local bluebonnets and the Gulf coast.

---

### E4. Promotional language [P1]

**Detection expressions:** boasts, vibrant, rich (figurative), profound, showcasing, exemplifies, commitment to, nestled, in the heart of, groundbreaking, renowned, breathtaking, must-visit, stunning, robust, leverage, streamline, seamless, cutting-edge, state-of-the-art, game-changing

**Before:**
> Nestled within the breathtaking region of Gonder, Alamata stands as a vibrant town with a rich cultural heritage.

**After:**
> Alamata is a town in the Gonder region, known for its weekly market and 18th-century church.

---

### E5. Vague sourcing / Weasel words [P1]

**Detection expressions:** Industry reports, Observers have cited, Experts argue, Some critics argue, several sources

**Before:**
> Experts believe it plays a crucial role in the regional ecosystem.

**After:**
> The river supports several endemic fish species, according to a 2019 survey by the Chinese Academy of Sciences.

---

### E6. "Challenges and Future Prospects" formula [P1]

**Detection expressions:** Despite its... faces challenges..., Despite these challenges, Future Outlook

**Before:**
> Despite its industrial prosperity, the area faces challenges typical of urban areas. Despite these challenges, it continues to thrive.

**After:**
> Traffic congestion increased after 2015. The corporation began a drainage project in 2022 to address recurring floods.

---

### E7. AI-frequent vocabulary [P1]

**Detection expressions:** Additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, interplay, intricate/intricacies, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant, nuanced, multifaceted, realm, paradigm, synergy

**Before:**
> Additionally, a distinctive feature is the intricate interplay between tradition and innovation, showcasing the vibrant tapestry of local culture.

**After:**
> Local dishes blend Italian pasta with traditional Somali spices, a leftover from colonization.

---

### E8. Copula avoidance [P2]

**Detection expressions:** serves as [a], stands as [a], marks [a], represents [a], boasts [a], features [a], offers [a]

**Before:**
> Gallery 825 serves as LAAA's exhibition space. The gallery features four rooms and boasts 3,000 square feet.

**After:**
> Gallery 825 is LAAA's exhibition space. It has four rooms totaling 3,000 square feet.

---

### E9. Negative parallel structure [P2]

**Detection expressions:** Not only...but..., It's not just about..., it's..., It's not merely..., it's...

**Before:**
> It's not just about the beat; it's part of the aggression. It's not merely a song, it's a statement.

**After:**
> The heavy beat adds to the aggressive tone.

---

### E10. False ranges [P2]

**Detection expressions:** from X to Y, from A to B (when not a meaningful scale)

**Before:**
> Our journey has taken us from the singularity of the Big Bang to the grand cosmic web, from the birth of stars to the dance of dark matter.

**After:**
> The book covers the Big Bang, star formation, and current dark matter theories.

---

### E11. Em dash overuse [P2]

**Problem:** AI overuses em dashes (—) in a sales-copy style.

**Rule:** Maximum 1 em dash per paragraph. Replace extras with commas or parentheses.

---

### E12. Bold overuse / Inline header lists [P2]

**Problem:** Mechanically applies bold to key terms, or repeats the `- **Header:** Description` pattern.

**Before:**
> - **User Experience:** Significantly improved with a new interface.
> - **Performance:** Enhanced through optimized algorithms.
> - **Security:** Strengthened with end-to-end encryption.

**After:**
> The update improves the interface, speeds up load times through optimized algorithms, and adds end-to-end encryption.

**Rule:** Bold only where emphasis is truly needed. Max 1-2 per paragraph.

---

### E13. Conversation residue / Flattery / Recent clichés [P1]

**Detection expressions:** I hope this helps, Of course!, Certainly!, You're absolutely right!, Would you like..., let me know, here is a..., Great question!, That's an excellent point!, Absolutely!, "Let's dive in", "Let's break this down", "Here's the thing", "It's worth noting that", "This is where X comes in", "The key takeaway here is", "At the end of the day", "In a world where...", "Here's the reality:", "The bottom line:"

**Problem:** Chatbot conversation traces and post-2024 AI clichés. Delete all.

**Before:**
> Great question! Let's dive in. Here's the thing — in a world where AI is rapidly evolving, it's worth noting that the key takeaway here is adaptability. At the end of the day, this is where human creativity comes in. I hope this helps!

**After:**
> AI tools change fast. The useful skill isn't mastering any one tool — it's learning to evaluate new ones quickly.

---

### E14. Filler phrases [P2]

| Before | After |
|--------|-------|
| In order to | To |
| Due to the fact that | Because |
| At this point in time | Now |
| In the event that | If |
| has the ability to | can |
| It is important to note that | (delete) |
| It goes without saying that | (delete) |

---

### E15. Excessive hedging [P2]

**Before:**
> It could potentially possibly be argued that the policy might have some effect.

**After:**
> The policy may affect outcomes.

---

### E16. Curly quotes [P3]

**Problem:** ChatGPT uses curly quotes (\u201c...\u201d). Causes issues in code and technical docs.

**Rule:** Replace all with straight quotes ("...").

---

### E17. Title case in headings [P3]

**Before:** `## Strategic Negotiations And Global Partnerships`

**After:** `## Strategic negotiations and global partnerships`

---

## Common Patterns

### C1. Synonym cycling (Elegant Variation) [P2]

**Problem:** AI keeps renaming the same thing to avoid repetition.

**Before:**
> 주인공은 많은 도전에 직면한다. 이 인물은 장애물을 극복해야 한다. 해당 캐릭터는 결국 승리한다. 우리의 영웅은 집으로 돌아간다.

**After:**
> 주인공은 많은 도전에 직면하지만 결국 이겨내고 집으로 돌아간다.

---

### C2. Knowledge cutoff disclaimers [P1]

**Detection (KR):** "정확한 정보는 확인이 필요합니다", "최신 정보와 다를 수 있습니다"
**Detection (EN):** "as of [date]", "Up to my last training update", "based on available information"

**Rule:** Delete all. Find accurate sources, or state ignorance plainly.

---

### C3. Positive conclusion formula [P1]

**Detection (KR):** "밝은 미래가 기대됩니다", "무한한 가능성이 열려 있습니다", "함께 노력해야 할 것입니다"
**Detection (EN):** "The future looks bright", "Exciting times lie ahead", "a major step in the right direction"

**Rule:** Replace with concrete next steps, or delete.

---

### C4. Emoji decoration [P1]

**Problem:** Adding emojis to headings or list items.

**Rule:** Remove all unless user explicitly requests them.

---

### C5. Uniform paragraph length [P2]

**Problem:** AI tends to make all paragraphs the same length (3-4 sentences). Humans write single-sentence paragraphs and long paragraphs both.

**Rule:** If paragraph lengths are mechanically uniform, merge some or split some to create rhythm.

---

### C6. Forced three-part structure [P2]

**Problem:** AI forces "Introduction → Body → Conclusion" regardless of text type. Even short texts get introductions and conclusions.

**Rule:** Remove introduction/conclusion if they don't fit the text's length and purpose. "결론적으로" in text under 500 characters is almost always unnecessary.

---

## Full Example

### Before (Korean AI text):

> 오늘날 급변하는 디지털 시대에 접어들면서, AI 코딩 도구에 대한 관심이 날로 높아지고 있습니다. 이번 글에서는 AI 코딩 도구의 다양한 측면에 대해 자세히 알아보겠습니다.
>
> AI 코딩 도구는 혁신적인 기술을 통해 개발자들의 생산성을 획기적으로 향상시키는 핵심적인 역할을 하고 있다고 할 수 있습니다. 이를 통해 효과적인 코드 작성이 가능해지며, 이를 바탕으로 체계적인 개발 환경을 구축할 수 있습니다.
>
> 그렇다면 왜 AI 코딩 도구가 필요할까요? 그 이유는 크게 세 가지로 나눌 수 있습니다.
>
> - 🚀 **생산성 향상:** AI 코딩 도구는 코드 자동 완성뿐만 아니라 리팩토링, 테스트 생성까지 지원하여 개발 속도를 혁신적으로 높여줍니다.
> - 💡 **품질 개선:** 다양한 코드 분석 기능을 통해 버그를 사전에 탐지하고 효과적으로 해결할 수 있습니다.
> - ✅ **학습 효과:** 초보 개발자들에게 체계적인 학습 경험을 제공하여 빠른 성장을 도울 수 있습니다.
>
> 물론 AI 코딩 도구에는 장점만 있는 것은 아닙니다. 한편으로는 생산성을 높여주지만, 다른 한편으로는 코드의 정확성 문제, 보안 취약점, 저작권 이슈 등 다양한 과제가 존재합니다. 이러한 관점에서 볼 때, AI 코딩 도구의 중요성은 아무리 강조해도 지나치지 않습니다.
>
> 결론적으로, AI 코딩 도구는 소프트웨어 개발의 미래를 밝게 만들어 줄 것으로 기대됩니다. 앞으로 AI 기술의 지속적인 발전과 함께 개발자 커뮤니티의 관심이 더욱 높아질 것입니다. 도움이 되셨길 바랍니다!

### After (human-written text):

> AI 코딩 도구가 생산성을 올려준다는 건 반쯤 맞다.
>
> 자동 완성이 빨라지는 건 체감된다. 보일러플레이트, 테스트 스캐폴딩, 반복 리팩토링 같은 건 확실히 빠르다. 다만 디버깅이나 설계 판단에서는 차이를 못 느꼈다. 자동 완성이 빨라지는 거지, 사고가 빨라지는 건 아닌 셈이다.
>
> 솔직히 말하면 가장 위험한 순간은 제안을 무비판적으로 수락할 때다. 컴파일 되고 린트 통과하고 그런데 틀린 코드, 나도 몇 번 당했다. 집중력이 떨어질 때 특히 그렇다.
>
> 보안 쪽은 더 걱정된다. AI가 생성한 코드의 취약점을 체계적으로 추적한 연구가 아직 많지 않다.
>
> 쓸 거면 쓰되, 모든 제안을 리뷰하고, 테스트를 먼저 쓰고, AI 제안은 그 테스트를 통과할 때만 수락하라.

### Change summary:
- [K1] Opening clichés removed ("오늘날", "알아보겠습니다")
- [K2] Exaggerated modifiers removed ("혁신적인", "획기적인", "체계적인", "효과적인", "핵심적인", "다양한")
- [K3] Hedging endings removed ("~라고 할 수 있습니다")
- [K4] "이를 통해/바탕으로" chains removed
- [K5] Empty importance claims removed
- [K6] "~뿐만 아니라" removed
- [K7] "그렇다면 왜~" self-Q&A removed
- [K8] Rule of three dismantled
- [K10] Closing clichés removed → replaced with practical advice
- [K11] Conversation residue removed ("도움이 되셨길 바랍니다!")
- [K13] Pros/cons symmetry dismantled → specific opinion given
- [C4] Emojis removed
- [C5] Uniform paragraph length varied → rhythm added
- [C6] Forced conclusion deleted
- [E12] Bold inline header list dismantled
- Soul injected: 1st person perspective, personal experience, honest opinions (Blog/Essay type)

---

## References

This skill is based on:
- [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — AI writing signs guide maintained by WikiProject AI Cleanup
- Observed patterns in Korean AI text analysis

Core insight: "LLMs are statistical algorithms that predict what comes next. The result converges to the most statistically likely, broadest-applicable output." The same principle operates in Korean, manifesting as high-frequency expressions like "다양한", "혁신적인", and "이를 통해".
