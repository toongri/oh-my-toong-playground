# fc-feedback

EA FC(EA Sports FC)/축구·풋살 코칭 피드백 유튜브 영상을 팀원별 카드가 있는
인터랙티브 HTML 문서로 만들고 팀 아카이브에 발행하는 스킬이다. 사용법과
계약은 `SKILL.md`·`references/contracts.md`를 본다.

## 추천 실행 모델

현재 추천은 **Claude Opus 5.5(effort high)**다. 12회차 비교에서 opus 평균
총점 88.5점이 sol 82.4점·luna 81.8점을 앞섰고, 심사와 무관한 자동 채점
점수에서도 앞섰다.

codex 환경에서 돌릴 때는 sol med 또는 luna max 중 아무 쪽이나 쓴다 — 둘의
차이는 반복 3회 규모에서 잡음 수준이다.

한계: 샘플 영상 1개, 반복 3회로 비교한 결과다. 근거는
[`round-12.md`](../../../../evals/fc-feedback/rounds/round-12.md)에 있다.
