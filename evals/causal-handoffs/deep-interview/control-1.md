현재 환불 권한 결정은 `open`입니다. owner 사례 하나의 허용을 일반 권한 규칙으로 확대하지 않았습니다.

| 항목 | 현재 기록 |
|---|---|
| id / component | refund-permission / 환불 요청 |
| question | viewer의 환불 요청을 권한상 허용할 것인가 |
| depends_on | 토폴로지·범위 선행 결정 해결됨 |
| status / choice | open / 미정 |
| basis | [from-user] owner U7, 주문 O17, 금액 700, 키 K7, paid 상태의 요청은 허용되며 R9를 생성하고 환불 한 건을 기록함. 이 사례만 확인됨 |
| alternatives | viewer 허용 / viewer 거부. 아직 선택·기각된 대안이나 합의한 절충 없음 |
| assumptions | owner 사례가 모든 owner 요청 또는 viewer 요청에 적용된다는 근거 없음 |
| checks | owner의 위 사례만 사용자 확인 완료. viewer U8·금액 900 사례는 인터뷰어가 제안했으나 미응답이며, 요청자와 금액이 함께 바뀌어 권한 차이만 검증하지 못함. 아래 질문도 아직 미응답 |
| reopen_reason | 없음. 처음부터 미결 상태 |

환불 권한을 정하기 위해, 제시했던 viewer 상황에서 금액만 기존 사례와 같은 700으로 맞추겠습니다. 주문 O17·키 K7·paid 상태를 그대로 두고 요청자만 owner U7에서 viewer U8로 바꾸면, 이 요청은 **권한상 허용되어야 하나요, 거부되어야 하나요?**
