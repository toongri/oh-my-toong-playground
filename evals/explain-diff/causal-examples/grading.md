# 재시도 전이 질문 채점

범위: 라이브 explain-diff 세션이 아닌 독립 채점 실험이며, 세 답변은 서로 독립적으로 평가했다.

출처는 `green-2.md`의 Case A 작성자 전용 전이 질문과 `skills/explain-diff/SKILL.md` Step 9, `skills/explain-diff/references/rubric.md` R8이다.

질문: 첫 번째 실패 직후 `nextAction(1)`의 반환값은 무엇이며, 어떤 조건 판단 때문에 그렇게 되는가?

실제 채점 항목은 결과(`retry`)와 이유(`1 < 3`이 참이어서 첫 번째 선택지를 반환함)이며, 둘을 별도로 충족해야 complete이다.

| 답변 | 판정 | result | reason | 이유 |
|---|---|---|---|---|
| retry입니다. | incomplete | hit | missing | 반환값은 맞지만 `1 < 3`이 참이라는 조건 판단이 빠졌다. |
| retry입니다. 완료한 실패가 1회라 1 < 3이 참이고 첫 번째 값을 반환하기 때문입니다. | complete | hit | hit | 정확한 반환값과 비교식의 참 여부를 첫 번째 선택지 반환에 연결하여 두 항목을 모두 충족했다. |
| stop입니다. 한 번 실패하면 중단합니다. | incomplete | missing | missing | 반환값이 틀리고 한 번 실패하면 중단한다는 설명도 `1 < 3`이 참이라는 실제 규칙에 어긋난다. |

`missing`은 해당 루브릭을 충족하지 못했다는 뜻이며, 세 번째 답변의 이유는 단순 생략이 아니라 오답이다.
