결정: 환불 요청 권한. 확인된 것은 owner U7의 한 사례이며, viewer의 권한은 아직 미정입니다. 이 결정을 내려야 제시한 요청을 권한 단계에서 차단할지 정할 수 있습니다.

viewer U8이 paid 상태의 주문 O17에 금액 900, 요청 키 K7로 환불을 요청한 상황에서, 금액·요청 키 검증과 별개로 viewer의 환불 요청을 권한 단계에서 거절할까요, 아니면 viewer에게도 환불 요청 권한을 허용할까요?

현재 결정 등록부:

| 항목 | 내용 |
|---|---|
| id / component | refund-permission / 환불 요청 |
| question | viewer에게 환불 요청 권한을 부여하는가? |
| depends_on | 토폴로지·범위 선행 결정은 해결됨. 추가 미해결 선행 결정 없음. |
| status | open |
| choice | 미정. 기존 owner 사례의 허용을 일반 권한 규칙으로 확대하지 않음. |
| basis | [from-user] owner U7, 주문 O17, 금액 700, 요청 키 K7, paid 상태의 요청은 허용되어 R9를 생성하고 환불 1건을 기록함. |
| alternatives | viewer 권한 거절 / viewer 권한 허용. 선택 및 기각 근거는 아직 없음. 전자는 viewer의 환불 시작을 제한하고, 후자는 허용하되 다른 검증의 통과까지 뜻하지 않음. |
| assumptions | owner 전체의 일반 권한 규칙은 확인되지 않음. viewer 제안에서는 역할뿐 아니라 금액도 달라졌으므로 결과를 권한 때문이라고 미리 단정할 수 없음. |
| checks | owner의 위 단일 사례 확인 완료. viewer U8·O17·900·K7·paid 사례는 제안만 되었고 답변·결과는 미확인. |
| reopen_reason | 없음. 아직 결정을 확정하지 않았음. |
