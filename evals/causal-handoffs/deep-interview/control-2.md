현재 결정 기록

- `id`: refund-permission / `component`: 환불 요청
- `question`: viewer에게 환불 요청 권한을 허용할지
- `depends_on`: 선행 토폴로지·범위 결정은 해결됨
- `status`: open
- `choice`: 미정
- `basis`: [from-user] owner U7이 paid 상태인 O17에 금액 700, 요청 키 K7로 요청한 사례만 허용으로 확인됨. R9가 생성되고 환불 1건이 기록됨. 일반 권한 규칙은 확인되지 않음.
- `alternatives`: viewer 허용 / viewer 거부. 아직 선택하거나 배제한 대안과 합의한 절충점은 없음.
- `assumptions`: owner 사례의 결과를 viewer에게 일반화하지 않음.
- `checks`: owner 사례는 사용자 확인 완료. viewer U8·금액 900·O17·K7·paid 사례는 제안만 했으며 답변과 결과는 미확인. 요청자와 금액을 함께 바꿨으므로 권한 효과만 분리하지 못함.
- `reopen_reason`: 없음. 원래부터 미결정 상태.

다음 질문

권한에 따른 차이만 확인하도록 제시한 viewer 상황에서 금액을 원래의 700으로 맞추겠습니다. O17·금액 700·K7·paid를 그대로 두고 요청자만 owner U7에서 viewer U8로 바꾼 경우, 권한 판단 결과는 어떻게 되어야 하나요?
