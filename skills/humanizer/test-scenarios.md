# Humanizer Skill — Test Scenarios

These scenarios verify that the humanizer skill enables agents to correctly detect AI writing patterns and rewrite text naturally.

## Scenario 1: Korean Blog Post — Full AI Pattern Saturation

**Type:** Application (technique skill)
**Content type:** Blog/Essay
**Mode:** rewrite

**Input text:**
```
오늘날 급변하는 디지털 시대에 접어들면서, 원격 근무에 대한 관심이 날로 높아지고 있습니다. 이번 글에서는 원격 근무의 다양한 측면에 대해 자세히 알아보겠습니다.

원격 근무는 혁신적인 업무 방식을 통해 직원들의 생산성을 획기적으로 향상시키는 핵심적인 역할을 하고 있다고 할 수 있습니다. 이를 통해 효과적인 협업이 가능해지며, 이를 바탕으로 체계적인 업무 환경을 구축할 수 있습니다.

그렇다면 왜 원격 근무가 필요할까요? 그 이유는 크게 세 가지로 나눌 수 있습니다.

- 🚀 **유연성 향상:** 원격 근무는 시간 관리뿐만 아니라 장소 선택의 자유까지 제공하여 업무 효율을 혁신적으로 높여줍니다.
- 💡 **비용 절감:** 다양한 비용 절감 효과를 통해 기업과 직원 모두에게 효과적인 혜택을 제공할 수 있습니다.
- ✅ **인재 확보:** 체계적인 원격 근무 시스템은 지역에 구애받지 않는 탁월한 인재 채용을 가능하게 합니다.

물론 원격 근무에는 장점만 있는 것은 아닙니다. 한편으로는 유연성을 제공하지만, 다른 한편으로는 소통 부재, 고립감, 업무 경계 모호화 등 다양한 과제가 존재합니다. 소프트웨어 개발에 있어서 원격 근무의 중요성은 아무리 강조해도 지나치지 않습니다.

결론적으로, 원격 근무는 미래 업무 방식의 발전이 더욱 기대되며, 기업과 직원들의 지속적인 관심이 필요합니다. 도움이 되셨길 바랍니다!
```

**Expected detections (minimum):**
| Pattern | Severity | Instance |
|---------|----------|----------|
| K1 | P1 | "오늘날 급변하는 디지털 시대에", "알아보겠습니다", "이번 글에서는" |
| K2 | P1 | "혁신적인", "획기적인", "체계적인", "효과적인", "다양한"(x3), "핵심적인", "탁월한" |
| K3 | P1 | "~라고 할 수 있습니다" |
| K4 | P1 | "이를 통해", "이를 바탕으로" |
| K5 | P1 | "관심이 날로 높아지고", "중요성은 아무리 강조해도" |
| K6 | P2 | "~뿐만 아니라 ~까지" |
| K7 | P2 | "그렇다면 왜 ~할까요?" |
| K8 | P2 | Forced rule of three |
| K9 | P2 | "~에 있어서" |
| K10 | P1 | "결론적으로", "발전이 기대되며", "지속적인 관심이 필요합니다" |
| K11 | P1 | "도움이 되셨길 바랍니다!" |
| K13 | P2 | "장점만... 한편으로는...다른 한편으로는" |
| C4 | P1 | Emoji decoration (🚀💡✅) |
| C5 | P2 | Uniform paragraph length |
| E12 | P2 | Bold inline header list pattern |

**Expected rewrite behavior:**
- All P1 patterns removed
- Soul injected (1st person, opinions, rhythm variation) — blog/essay type
- Core meaning preserved (remote work pros/cons)
- No fabricated facts
- Emoji removed
- Bold inline header list converted to prose

**PASS criteria:**
1. Agent identifies ≥12 of the 15+ patterns listed above
2. Rewritten text contains zero P1 patterns
3. Rewritten text shows rhythm variation (mixed sentence lengths)
4. Rewritten text includes at least one opinion or 1st-person element
5. No facts invented that weren't in original

---

## Scenario 2: Korean Technical Documentation — No Soul Injection

**Type:** Application + variation
**Content type:** Technical documentation
**Mode:** rewrite

**Input text:**
```
이번 문서에서는 API 인증 시스템에 대해 알아보겠습니다.

OAuth 2.0은 혁신적인 인증 프로토콜로, 다양한 플랫폼에서 효과적으로 활용되고 있습니다. 이를 통해 안전한 인증이 가능해지며, 이를 바탕으로 체계적인 보안 환경을 구축할 수 있습니다.

인증 흐름은 크게 세 단계로 구성됩니다:
1. 클라이언트가 Authorization Server에 인증을 요청합니다
2. 사용자가 권한을 승인하면 Authorization Code가 발급되어집니다
3. 클라이언트가 코드를 Access Token으로 교환합니다

보안에 있어서 토큰 관리의 중요성은 아무리 강조해도 지나치지 않습니다. Access Token의 유효기간을 짧게 설정하고, Refresh Token을 활용하여 갱신하는 것이 효과적인 방법입니다.
```

**Expected detections:**
| Pattern | Severity | Instance |
|---------|----------|----------|
| K1 | P1 | "이번 문서에서는 ~에 대해 알아보겠습니다" |
| K2 | P1 | "혁신적인", "다양한", "효과적인/효과적으로", "체계적인" |
| K4 | P1 | "이를 통해", "이를 바탕으로" |
| K5 | P1 | "중요성은 아무리 강조해도" |
| K9 | P2 | "~에 있어서" |
| K14 | P2 | "발급되어집니다" (double passive) |
| K16 | P3 | "활용하여" → "써서" (but may be acceptable in tech docs) |

**Expected rewrite behavior:**
- AI patterns removed
- **NO soul injection** (no 1st person, no opinions, no humor)
- Technical accuracy preserved exactly
- Dry, precise tone maintained
- OAuth 2.0 flow steps preserved accurately
- "발급되어집니다" → "발급됩니다" (fix double passive)
- K16 한자어: may keep "활용" in tech context (acceptable)

**PASS criteria:**
1. Agent identifies it as technical documentation
2. No personality/opinion/1st-person injected
3. OAuth 2.0 flow accuracy preserved perfectly
4. P1 patterns removed
5. Double passive ("되어지다") fixed

---

## Scenario 3: English Marketing Copy — Audit Mode

**Type:** Application (audit mode)
**Content type:** Marketing/Copy
**Mode:** audit

**Input text:**
```
Nestled in the heart of Silicon Valley, our groundbreaking AI platform stands as a testament to innovation. It's not just about automation — it's about transforming the very fabric of how businesses operate.

Our robust, seamless solution leverages cutting-edge machine learning to deliver stunning results. Additionally, the intricate interplay between our proprietary algorithms creates a vibrant ecosystem that fosters unprecedented growth.

From startups to enterprises, our platform showcases the power of AI. Great question if you're wondering about pricing — let's dive in! Our flexible plans ensure that every business, regardless of size, can harness this game-changing technology.

The future looks bright. Exciting times lie ahead as we continue to push the boundaries of what's possible. I hope this helps!
```

**Expected audit report (minimum detections):**
| Pattern | Severity | Instance |
|---------|----------|----------|
| E4 | P1 | "Nestled", "groundbreaking", "robust", "seamless", "leverage", "cutting-edge", "stunning", "vibrant", "game-changing" |
| E1 | P1 | "stands as a testament", "evolving" |
| E9 | P2 | "It's not just about...it's about..." |
| E7 | P1 | "Additionally", "intricate", "interplay", "tapestry"→"fabric", "showcases", "fosters" |
| E3 | P1 | "fostering" |
| E13 | P1 | "Great question", "let's dive in", "I hope this helps!" |
| E11 | P2 | Multiple em dashes |
| C3 | P1 | "The future looks bright", "Exciting times lie ahead" |

**Expected output format:**
```
## Detection Report

Total detections: N (P1: n, P2: n, P3: n)

| # | Location | Severity | Pattern | Original | Suggestion |
|---|----------|----------|---------|----------|------------|
| 1 | L1       | P1       | E4 Promotional language | "Nestled in the heart of" | "Based in" |
...
```

**PASS criteria:**
1. Output is report ONLY — no text modifications
2. Uses correct table format with all columns
3. Identifies ≥8 of the patterns listed
4. Each detection has pattern code (E1-E16, C1-C6)
5. Suggestions are concrete, not vague
6. Marketing context noted (reduce exaggeration but maintain persuasion)

---

## Scenario 4: Context-Sensitive Detection — False Positive Avoidance

**Type:** Variation (edge cases)
**Content type:** Blog/Essay
**Mode:** audit

**Input text:**
```
Kubernetes는 다양한 워크로드를 관리한다. 스테이트풀셋, 데몬셋, 크론잡 등 워크로드 타입이 다양하기 때문이다.

이 문제는 중요하다. 프로덕션 장애의 40%가 설정 오류에서 시작되기 때문이다.

또한 모니터링도 신경 써야 한다. Prometheus + Grafana 조합을 쓰면 대시보드 하나로 클러스터 상태를 볼 수 있다.

혁신적인 기술 도입보다는 기본에 충실한 운영이 장기적으로 더 안정적이다.
```

**Expected behavior:**
| Expression | Should Flag? | Reason |
|------------|-------------|--------|
| "다양한" (1st use, para 1) | NO | Single use with specific examples following ("스테이트풀셋, 데몬셋, 크론잡") |
| "다양하기" (2nd use, para 1) | MAYBE P2 | Second occurrence in same paragraph, but contextually justified |
| "중요하다" | NO | Followed by concrete reason (40% statistic) — not empty emphasis |
| "또한" (para 3) | NO | Single use, logically connecting new topic |
| "혁신적인" (para 4) | P1 | Classic AI adjective even though used in negative context |

**PASS criteria:**
1. Does NOT flag "다양한" first use as P1 (it's followed by specific examples)
2. Does NOT flag "중요하다" (backed by data)
3. Does NOT flag single "또한" as overuse
4. DOES flag "혁신적인" even in negative context
5. Demonstrates contextual judgment, not mechanical keyword matching

---

## Scenario 5: Meaning Preservation Under Rewrite

**Type:** Application (meaning preservation)
**Content type:** Blog/Essay
**Mode:** rewrite

**Input text:**
```
최근 조사에 따르면 개발자의 73%가 AI 코딩 도구를 사용하고 있으며, 이 중 42%는 매일 사용한다고 합니다. 이를 통해 평균 코딩 속도가 55% 향상되었다는 연구 결과가 있습니다.

그렇다면 왜 이렇게 빠르게 확산되고 있을까요? Stack Overflow의 2024 Developer Survey에 따르면, 주된 이유는 보일러플레이트 코드 작성 시간 절감이었습니다.

하지만 GitHub의 연구에서는 AI 생성 코드의 보안 취약점 비율이 수동 작성 코드보다 1.4배 높다는 결과도 보고되었습니다.
```

**Expected rewrite behavior:**
- ALL numbers preserved exactly: 73%, 42%, 55%, 2024, 1.4배
- ALL sources preserved: Stack Overflow Developer Survey, GitHub 연구
- AI patterns removed (K4 "이를 통해", K7 "그렇다면 왜", K3 "~다고 합니다")
- Factual claims not embellished or invented

**PASS criteria:**
1. Every number (73%, 42%, 55%, 1.4배) appears in rewrite
2. Source attributions (Stack Overflow, GitHub) preserved
3. No new facts or statistics invented
4. AI patterns successfully removed
5. Meaning of each claim unchanged

---

## Scenario 6: Mixed Language with Curly Quotes

**Type:** Application (E16 + mixed)
**Content type:** Technical blog
**Mode:** rewrite

**Input text:**
```
The “serviceless” architecture is gaining traction. In a world where cloud costs are spiraling, it’s worth noting that this approach can reduce infrastructure spend by up to 60%.

여기서 핵심은 “serviceless”가 단순히 서버리스의 확장이 아니라는 것입니다. 이를 통해 개발자들은 인프라 관리에서 완전히 해방될 수 있으며, 이러한 측면에서 혁신적인 패러다임 전환이라고 할 수 있습니다.

Additionally, the intricate interplay between edge computing and serviceless patterns creates a robust foundation for next-generation applications. The future looks bright for this technology.
```

**Expected detections:**
- E16: Curly quotes (“”, ’) → straight quotes
- E13: "In a world where", "it's worth noting that"
- E7: "Additionally", "intricate", "interplay", "robust"
- C3: "The future looks bright"
- K2: "혁신적인"
- K3: "~라고 할 수 있습니다"
- K4: "이를 통해", "이러한 측면에서"

**PASS criteria:**
1. Curly quotes converted to straight quotes
2. Both Korean and English patterns detected in same text
3. 60% statistic preserved
4. "serviceless" concept preserved accurately
5. Mixed-language flow maintained naturally
