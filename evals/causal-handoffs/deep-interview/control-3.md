권한 결정이 남아 있어, 금액과 요청 키 처리의 결과와 구분해서 확인하겠습니다. 제시한 상황(viewer U8, 주문 O17, 금액 900, 요청 키 K7, 주문 상태 paid)에서 적용할 권한 규칙은 **viewer는 환불 요청 권한이 없어 거절**인가요, 아니면 **viewer도 권한 검사를 통과하고 금액·요청 키 검사를 이어감**인가요?

현재 결정 기록

- `id`: refund-permission
- `question`: viewer의 환불 요청 권한을 허용할 것인가
- `component`: 환불 요청
- `depends_on`: 토폴로지·범위 선행 결정은 모두 해결됨
- `status`: open
- `choice`: 미정. owner의 확인 사례를 일반 권한 규칙으로 확대하지 않음.
- `basis`: [from-user] owner U7이 paid 주문 O17에 금액 700, 요청 키 K7로 요청한 사례는 허용되며 R9가 생성되고 환불 한 건이 기록됨. 사용자는 권한부터 결정하겠다고 했으나 viewer 허용 여부는 답하지 않음.
- `alternatives`: viewer 권한 거절 / viewer 권한 통과. 아직 선택·기각된 대안이나 수용한 절충은 없음.
- `assumptions`: owner 일반 허용 규칙과 viewer 권한은 확인되지 않음. 금액 변경·K7 재사용이 권한 판단에 미치는 영향도 추정하지 않음.
- `checks`: owner의 위 사례만 확인됨. viewer U8·900·K7·paid 사례는 제안만 했고 답변 및 검증 결과 없음. 여러 조건이 달라 전체 요청의 성공·실패만으로 권한 규칙을 확정할 수 없음.
- `reopen_reason`: 없음. 계속 미결 상태.
