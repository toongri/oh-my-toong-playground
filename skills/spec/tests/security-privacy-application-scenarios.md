# Security / Privacy Application Scenarios

Area: Security / Privacy
Reference: `skills/spec/references/security-privacy.md`
Scenario Count: 2

---

### SP-1: 사용자 대면 시스템 전체 보안+개인정보 설계 (Happy Path)

**Technique Under Test**: Steps 1-5 Full Security Design (security-privacy.md lines 49-145) — Authentication + Authorization + Data Protection + Privacy/Compliance + Threat Modeling

**Input**: B2C 헬스케어 앱 설계. 사용자: 일반 소비자(회원 가입/소셜 로그인), 의료 전문가(기관 계정), 시스템 관리자. 기능: 개인 건강 기록 조회/입력, 의료 전문가와 기록 공유, 알림 발송. 데이터: 이름/이메일/생년월일(개인정보), 혈압/혈당/진료 기록(민감 건강 정보). 규정: GDPR 적용(EU 사용자 포함), 국내 개인정보보호법. 외부 노출: 공개 API, 소셜 로그인(OAuth), 모바일 앱 클라이언트.

**Expected Output**: 전체 보안 설계 결과물 — (1) **Step 1 인증 설계**: 소비자(이메일+비밀번호, 소셜 OAuth/OIDC), 의료 전문가(기관 SSO), 관리자(MFA 필수) 인증 방식 구분, 세션 수명/만료/무효화 정책, 의료 기록 접근 시 재인증 정책 정의. (2) **Step 2 인가 모델**: RBAC 3역할(소비자/의료 전문가/관리자) + 리소스 수준 접근 제어(소유자-본인 기록만, 공유 허용 시 의료 전문가), 권한 위임 규칙(공유 승인/철회) 정의. (3) **Step 3 데이터 분류**: 공개/내부/기밀(개인정보)/제한(건강 기록) 4등급 분류, 등급별 보호 요구사항, PII 인벤토리(수집 항목, 접근 제한, 로그 마스킹 정책) 정의. (4) **Step 4 개인정보/컴플라이언스**: 개인정보 수집 최소화 원칙, 동의 모델(수집 목적별 별도 동의), 사용자 권리(열람/수정/삭제/이동), GDPR 데이터 보존 기간 정의. (5) **Step 5 위협 모델링**: 외부 공격 표면(공개 API, OAuth 콜백, 모바일 클라이언트), 주요 위협 시나리오(자격증명 탈취, 권한 상승, 건강 기록 유출), 시나리오별 완화 전략 정의.

**Pass Criteria**: (1) Step 1에서 주체 유형별(소비자/의료전문가/관리자) 인증 방식이 개별 정의되고, (2) Step 2에서 RBAC 역할과 리소스 수준 접근 제어(소유자 기반)가 모두 정의되며, (3) Step 3에서 건강 기록이 최고 민감 등급으로 분류되고 PII 인벤토리가 포함되고, (4) Step 4에서 GDPR/개인정보보호법 요건이 설계 제약으로 반영되며, (5) Step 5에서 외부 공격 표면 분석과 위협별 완화 전략이 포함됨. 인증 방식을 "로그인 기능 넣으면 됨"으로 뭉뚱그리면 RED. 역할별 권한 차이 없이 "관리자만 모든 권한"이면 RED. GDPR 적용 대상임에도 Step 4를 스킵하면 RED. 특정 암호화 알고리즘(AES-256 등)이나 라이브러리를 선택하면 RED.

---

### SP-2: 개인정보 없는 사내 도구 — Steps 4·5 Assess Necessity 스킵

**Technique Under Test**: Step 4 Assess Necessity gate (security-privacy.md lines 103-107) + Step 5 Assess Necessity gate (lines 126-130) — 개인정보/규제 없음 + 내부 전용 저위험 시스템 판정으로 두 단계 스킵

**Input**: 사내 IT 인프라 관리 도구 설계. 사용자: 사내 IT 엔지니어 10명(인터넷 접근 불가, VPN 필수). 기능: 서버 상태 모니터링, 배포 파이프라인 트리거, 인프라 설정 변경 이력 조회. 데이터: 서버 메트릭(CPU/메모리/디스크), 배포 로그, 설정 파일 — 개인정보 없음, 사내 운영 데이터만. 규정: GDPR/개인정보보호법 해당 없음(개인정보 미처리), 사내 정보보안 정책만 적용. 노출: 인터넷 미노출, VPN 내부망 전용, 외부 API 없음.

**Expected Output**: 단계적 Assess Necessity 처리 결과 — (1) **Step 1 인증 설계 정상 수행**: IT 엔지니어 인증(기업 SSO/LDAP), 세션 관리 정책, VPN 인증과의 관계 정의. (2) **Step 2 인가 모델 정상 수행**: 역할 구분(일반 엔지니어/시니어 엔지니어/관리자), 고위험 작업(프로덕션 배포, 설정 변경)에 대한 추가 승인 정책. (3) **Step 3 데이터 분류 정상 수행**: 서버 메트릭/배포 로그/설정 파일의 민감도 분류, 접근 제어 요구사항 정의. (4) **Step 4.1 Assess Necessity 수행**: 개인정보 처리 여부 분석 → 개인정보 없음 + 규제 요건 없음 → 4.2(Privacy by Design), 4.3(Consent/Retention) 스킵 판정 + 근거 명시. (5) **Step 5.1 Assess Necessity 수행**: 시스템 노출 및 데이터 민감도 분석 → 사내망 전용, 개인정보 없음, 외부 공격 표면 없음 → Step 5 전체(5.2 Attack Surface, 5.3 Threat Identification) 스킵 판정 + 근거 명시. (6) **Step 6 Document Generation으로 전환**: 두 단계 스킵 후 문서 생성 단계로 진행.

**Pass Criteria**: (1) Step 4.1에서 개인정보/규제 여부 분석이 수행되고, (2) 개인정보 없음 판정으로 4.2-4.3이 스킵되며 근거가 명시되고, (3) Step 5.1에서 위협 모델링 필요성 분석이 수행되고, (4) 내부 전용/저위험 판정으로 5.2-5.3이 스킵되며 근거가 명시되고, (5) Step 1-3(인증/인가/데이터 분류)은 스킵 없이 정상 수행됨. 개인정보가 없어도 GDPR 분석을 강제하면 RED. Assess Necessity 분석 없이 "내부 도구라 보안 불필요"로 Step 1-3까지 건너뛰면 RED. Step 4/5 스킵 근거가 "내부 도구이므로"처럼 모호하면 RED. 사용자 확인 없이 스킵을 단독 결정하면 RED.
