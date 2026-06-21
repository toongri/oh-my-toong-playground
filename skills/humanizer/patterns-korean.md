# Korean AI Pattern Catalog

> Replacement guidance for Korean patterns K1–K16 and K19–K21. K17 (em-dash) and K18 (middle-dot) bodies live inline in `SKILL.md` under `## Always-On Critical Patterns`.

## Table of Contents

- [K1. Opening clichés [P1]](#k1-opening-clichés-p1)
- [K2. Exaggerated modifiers [P1]](#k2-exaggerated-modifiers-p1)
- [K3. Hedging sentence endings [P1]](#k3-hedging-sentence-endings-p1)
- [K4. "이를 통해" chaining [P1]](#k4-이를-통해-chaining-p1)
- [K5. Empty importance claims [P1]](#k5-empty-importance-claims-p1)
- [K6. "~뿐만 아니라 ~도" overuse [P2]](#k6-뿐만-아니라-도-overuse-p2)
- [K7. "그렇다면" self-Q&A [P2]](#k7-그렇다면-self-qa-p2)
- [K8. Rule of Three [P2]](#k8-rule-of-three-p2)
- [K9. Formality overuse and "~에 있어서" [P2]](#k9-formality-overuse-and-에-있어서-p2)
- [K10. Closing clichés [P1]](#k10-closing-clichés-p1)
- [K11. Chatbot conversation residue [P1]](#k11-chatbot-conversation-residue-p1)
- [K12. Meaningless conjunctive adverbs [P2]](#k12-meaningless-conjunctive-adverbs-p2)
- [K13. Pros/cons symmetry structure [P2]](#k13-proscons-symmetry-structure-p2)
- [K14. Unnecessary passive constructions [P2]](#k14-unnecessary-passive-constructions-p2)
- [K15. "위해" overuse [P2]](#k15-위해-overuse-p2)
- [K16. Sino-Korean word overuse [P3]](#k16-sino-korean-word-overuse-p3)
- [K19. "이것이 ~다" definition closing (translated from "This is the X") [P2]](#k19-이것이-다-definition-closing-translated-from-this-is-the-x-p2)
- [K20. Mid-paragraph blockquote term definition [P2]](#k20-mid-paragraph-blockquote-term-definition-p2)
- [K21. Bilingual notation uniformity [P2]](#k21-bilingual-notation-uniformity-p2)

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

### K19. "이것이 ~다" definition closing (translated from "This is the X") [P2]

**Detection expressions:** "~ — 이것이 X의 핵심이다", "~. 이것이 ~의 핵심 역할이다", "이것이 X다", "이것이 X의 본질이다"

**Problem:** Direct translation of English "This is the core of X" / "This is X" closing patterns. Native Korean writers rarely close a paragraph by referring back with "이것이" — they tend to drop the demonstrative ("X의 핵심이다") or use a different rhythm ("바로 그 점이 ~", "그래서 ~", or no closing at all).

**Distinction from K3:** K3 covers hedging endings ("~라고 할 수 있습니다"). K19 covers *definitional* endings where a preceding clause is referred back to and labeled — a translated rhetorical move, not a hedge.

**Before:**
> 메시지를 일단 받아두고 나중에 처리할 수 있게 한다 — 이것이 메시지 브로커의 핵심 역할이다.

**After:**
> 메시지를 일단 받아두고 나중에 처리하게 해주는 것이 메시지 브로커가 하는 일이다.

또는: `메시지 브로커는 들어온 메시지를 받아뒀다가 나중에 처리하게 해준다.`

---

### K20. Mid-paragraph blockquote term definition [P2]

**Detection signal:** A `>` blockquote inserted in the middle of running prose for the sole purpose of defining a term, with the format `> term: definition.` or `> **term**: definition.`

**Problem:** LLMs love to break the flow of explanation to drop in a textbook-style term definition as a quote block. Native writers either (a) define inline in parentheses, (b) handle definitions in a separate glossary section, or (c) embed the definition in the surrounding sentence.

**Note:** Genuine *quotations* in blockquotes are fine. K20 only applies when the blockquote is the *writer's own* term definition wedged into prose.

**Before:**
> 큐는 작업을 보내고 응답을 기다리지 않는다.
>
> > fire-and-forget: 작업을 던지고 결과를 기다리지 않는 비동기 패턴.
>
> 그래서 큐는 fire-and-forget에 어울린다.

**After:**
> 큐는 작업을 보내고 응답을 기다리지 않는다(fire-and-forget). 그래서 ~ 패턴이 큐와 잘 맞는다.

---

### K21. Bilingual notation uniformity [P2]

**Detection signal:** Every technical term in the document is given consistently in `한국어(English)` form — e.g., "멱등(idempotent)", "소비자 그룹(consumer group)" — with no omissions and the same bracketing format throughout.

**Problem:** Native writers are inconsistent about bilingual notation. They give the English the first time a term appears, then drop it. Or they give the English only when the Korean translation is ambiguous. 100% consistency from start to finish — every technical term, every time, same format — is an LLM-uniformity tell.

**Rule:** Keep bilingual notation only on **first mention** of each term, or only where the Korean alone is ambiguous. Drop it on subsequent uses.

**Before:**
> 멱등(idempotent)한 처리가 필요하다. 멱등(idempotent)성을 보장하지 않으면 ~ . 멱등(idempotent) 키를 활용해 ~.

**After:**
> 멱등(idempotent)한 처리가 필요하다. 멱등성을 보장하지 않으면 ~. 멱등 키를 써서 ~.
