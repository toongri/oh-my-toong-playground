# Common Patterns

> Replacement guidance for cross-language patterns C1–C9.

## Table of Contents

- [C1. Synonym cycling (Elegant Variation) [P2]](#c1-synonym-cycling-elegant-variation-p2)
- [C2. Knowledge cutoff disclaimers [P1]](#c2-knowledge-cutoff-disclaimers-p1)
- [C3. Positive conclusion formula [P1]](#c3-positive-conclusion-formula-p1)
- [C4. Emoji decoration [P1]](#c4-emoji-decoration-p1)
- [C5. Uniform paragraph length [P2]](#c5-uniform-paragraph-length-p2)
- [C6. Forced three-part structure [P2]](#c6-forced-three-part-structure-p2)
- [C7. Table overuse [P1]](#c7-table-overuse-p1)
- [C8. Lecture-slide meta-structure [P2]](#c8-lecture-slide-meta-structure-p2)
- [C9. Uniform tone and tension throughout [P2]](#c9-uniform-tone-and-tension-throughout-p2)

### C1. Synonym cycling (Elegant Variation) [P2]

**Problem:** AI keeps renaming the same thing to avoid repetition.

**Before:**
> 주인공은 많은 도전에 직면한다. 이 인물은 장애물을 극복해야 한다. 해당 캐릭터는 결국 승리한다. 우리의 영웅은 집으로 돌아간다.

**After:**
> 주인공은 많은 도전에 직면하지만 결국 이겨내고 집으로 돌아간다.

---

### C2. Knowledge cutoff disclaimers [P1]

**Rule:** Delete all. Find accurate sources, or state ignorance plainly.

---

### C3. Positive conclusion formula [P1]

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

### C7. Table overuse [P1]

**Problem:** LLMs compulsively tabulate. Anything remotely comparable — pros vs cons, terms vs descriptions, before vs after, "three reasons" — gets converted to a table. Native human writing reserves tables for genuinely tabular data (multi-attribute comparison, lookup tables with ≥3 heterogeneous columns) and lets the rest flow as prose.

**Severity rule:** A document containing tables that should be prose → **P1**. Judgment is qualitative — apply when the writer was tabulating from compulsion rather than fit.

**Rule for rewrite:**
- Keep tables that have ≥3 columns of genuinely heterogeneous attributes
- Convert tables that are just "term: description" (2 columns) to a definition list or inline prose
- Convert tables that exist only to encode "A is for X, B is for Y" pairs to a single sentence

**Before:**
```
| 패턴 | 설명 |
|------|------|
| 큐 | 1:1 작업 분배 |
| 스트림 | n:n 데이터 분배 |
```

**After:**
> 큐는 1:1 작업 분배에, 스트림은 n:n 데이터 분배에 어울린다.

---

### C8. Lecture-slide meta-structure [P2]

**Problem:** Real human study notes are uneven. People scribble heavy notes on one section and skip the framing entirely on another. They forget the "한 줄 요약" or write it as an afterthought. The "헷갈렸던 지점" section, if present, is messy — half-formed sentences, asides, "왜인지 모르겠는데", maybe an unrelated tangent. When all four sections are present, polished, and each ends with a clean conclusion, the structure itself is the AI tell, regardless of content quality.

**Particularly suspicious:**
- "헷갈렸던 지점" / "Things I got confused about" written in clean, organized sentences — humans usually write these messily
- Every section has its own intro-body-outro micro-arc
- "참고자료" section listed without any personal commentary on what was useful

**Rule for rewrite:**
- Pick which structural section actually carries the writer's energy, expand it
- Compress or delete the sections that exist only for completeness
- Rewrite "헷갈렸던 지점" with one specific stuck moment rather than a polished list
- If "한 줄 요약" wasn't earned (the body doesn't actually deliver a 한 줄's worth of insight), delete it

---

### C9. Uniform tone and tension throughout [P2]

**Problem:** Humans get tired. Early sections of a long note are often careful, well-structured, with longer sentences. Later sections tend to compress: shorter sentences, more telegraphic phrasing, occasionally rougher punctuation, the occasional aside or even a frustrated tone. LLM output, by contrast, holds the *same* rhythm and register from the opening line to the closing line of an 8-section document.

**Distinct from C5 (uniform paragraph length):** C5 is about paragraph word counts. C9 is about *whole-document tension* — the writer's energy curve. A document can have varied paragraph lengths and still register as C9 if every paragraph has the same "voice temperature."

**How to spot:**
- Compare paragraph 1 and the second-to-last paragraph aloud — do they sound like the same person at the same energy level?
- Check if any section has noticeably shorter sentences than others (fatigue marker)
- Check if any section has tangents, asides, or partial sentences (humanity markers)
- If none of these vary across the document, flag C9

**Rule for rewrite (Blog/Essay only):**
- Introduce rhythm variation in the latter half: shorten sentences, drop the occasional connective, allow one fragment
- Add a single human aside or self-correction somewhere past the midpoint
- For technical docs, C9 is acceptable — do not flag
