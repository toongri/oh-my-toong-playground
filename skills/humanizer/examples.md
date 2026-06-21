# Worked Example & References

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
