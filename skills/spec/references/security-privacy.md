# Security / Privacy

## Contents

- **Role** — Defines the specialist's mandate: systematically designing how the system protects data and access, controls who can do what, handles sensitive information, and maps security requirements to regulatory obligations. Read this first to understand scope and expected output.
- **Principles** — Design guardrails: work at strategy and policy level (not implementation), distinguish security controls from privacy principles, and ensure every sensitive data path has explicit access boundaries and failure behavior. Includes document scope boundaries and coordination table with other Design Areas.
- **Review Perspective** — Evaluation criteria for assessing a completed security/privacy design. Covers authentication strategy, authorization model, data classification, PII handling, privacy by design, and threat model — plus explicit overstepping signals to avoid.
- **Vague Answer Clarification Examples** — A reference table of common vague user responses (e.g., "HTTPS면 충분하지", "권한은 나중에 나눠") paired with targeted clarifying questions. Use during interview steps when users respond ambiguously about auth, access control, or compliance.
- **Process** — The six-step design workflow: Step 1 (Authentication & Identity), Step 2 (Authorization & Access Control), Step 3 (Data Protection), Step 4 (Privacy & Compliance — conditional), Step 5 (Threat Modeling — conditional), Step 6 (Document Generation). Each step includes sub-tasks and a Checkpoint.
- **Output Template** — A markdown template for the final design document. Sections cover Authentication & Identity, Authorization Model, Permission Matrix, Data Classification, PII Handling, Privacy & Compliance (if applicable), and Threat Model (if applicable).

## Role

As a security and privacy design specialist, systematically define how the system protects data and access, who can do what, how sensitive information is handled, and what happens when security requirements intersect with regulatory obligations.

**Output Format**: See **Output Template** section below

## Principles

- Define security at Strategy + Policy level (not implementation: specific algorithms, libraries, or configurations)
- Focus on what protections are required and why, not how they are technically implemented
- Distinguish between security controls (technical enforcement) and privacy principles (data handling philosophy)
- Every sensitive data path must have explicit access boundaries, protection strategy, and failure behavior

### Document Scope

- **Include**: Authentication strategy, authorization model, data classification, encryption policy, PII handling approach, privacy by design principles, consent strategy, data retention policy, threat model boundaries, regulatory requirement mapping
- **Exclude**: Specific encryption algorithms (AES-256 vs ChaCha20), library selection, penetration testing procedures, compliance audit checklists, certificate authority configuration, key rotation schedules, security tool configuration

### Coordination with Other Areas

| Concern | Primary Area | Secondary Area | Boundary |
|---------|--------------|----------------|----------|
| Auth in API design | Security / Privacy | Interface Contract | Define auth strategy here, implement in API contract there |
| Data protection at rest | Security / Privacy | Data Schema | Define protection policy here, implement encryption/masking in schema there |
| Secure communication | Security / Privacy | Integration Pattern | Define security requirements here, implement TLS/mTLS there |
| Security monitoring | Security / Privacy (criteria) | Operations Plan (implementation) | Define what to monitor here, define how to measure there |

## Review Perspective

**Stance**: Evaluate whether authentication strategy, authorization model, data protection policy, and privacy principles are defined at the strategy and policy level without specifying cryptographic implementations or security library choices.

**Evaluate**:
- Authentication strategy per principal type (end users, service accounts, external systems)
- Authorization model (RBAC/ABAC/hybrid) with permission boundaries defined
- Data classification tiers and protection requirements per tier
- PII inventory, handling policy, and data lifecycle (retention, deletion, anonymization)
- Privacy by design principles and consent model (if applicable)
- Threat model boundaries and mitigation approach at policy level (if applicable)

**Do NOT evaluate**:
- Specific encryption algorithms or key lengths (implementation decision)
- Security library or tool selection (implementation decision)
- Penetration testing procedures or compliance audit checklists (operational concern)
- Certificate authority configuration or key rotation schedules (infrastructure concern)

**Overstepping Signal**: Mentions specific encryption parameters like key length or cipher mode (e.g., AES-256-GCM); references security library API calls or JWT library configuration; proposes certificate chain details or CA pinning strategy.
→ Reframe at policy level (e.g., "data at rest must be encrypted" not "use AES-256-GCM with PKCS#7 padding") or note as informational only.

## Vague Answer Clarification Examples

When users respond vaguely to security or privacy questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "HTTPS면 충분하지" | "전송 암호화는 기본입니다. 저장 데이터 암호화는? 키 관리 전략은? 인증서 갱신 정책은?" |
| "로그인만 넣으면 돼" | "인증 방식은? (세션/JWT/OAuth) 다중 인증(MFA)은? 비밀번호 정책은? 세션 만료 전략은?" |
| "권한은 나중에 나눠" | "권한 모델은 설계 초기부터 결정해야 합니다. RBAC/ABAC 중 어느 방식인가요? 최소 권한 원칙을 어떻게 적용하나요?" |
| "개인정보는 암호화하면 돼" | "어떤 데이터가 개인정보인가요? 암호화 범위는? 복호화 권한은 누가 갖나요? 키 접근 통제는?" |
| "관리자만 볼 수 있어" | "'관리자'의 범위는 어디까지인가요? 관리자 간 권한 차이는? 감사 로그는 누가 검토하나요?" |
| "법적으로 다 맞출 거야" | "어떤 규정이 적용되나요? (GDPR, PIPA, CCPA) 각 규정의 핵심 요건 중 설계에 영향을 주는 것은?" |
| "보안은 인프라팀이 담당해" | "인프라 보안과 애플리케이션 보안의 경계는? 애플리케이션 레벨에서 책임지는 보안 항목은?" |
| "사용자 동의 받으면 되잖아" | "동의의 범위와 방식은? 동의 철회 시 데이터 처리는? 미동의 사용자에게 어떤 기능이 제한되나요?" |
| "토큰 쓰면 안전하지" | "토큰 방식은? (JWT/opaque) 만료 정책은? 토큰 탈취 시 무효화 전략은? 리프레시 토큰 보안은?" |
| "해킹은 신경 안 써도 돼" | "공격 표면 분석은 규모와 무관하게 필요합니다. 어떤 데이터가 가장 민감한가요? 가장 우려되는 위협 시나리오는?" |

## Process

### Step 1: Authentication & Identity Design

#### 1.1 Authentication Strategy
- Identify: Who needs to authenticate? (end users, service accounts, external systems)
- Define: Authentication method for each principal type (password-based, OAuth/OIDC, API key, certificate)
- Specify: Identity provider — internal or external (e.g., social login, enterprise SSO)
- Review: Discuss with user

#### 1.2 Session & Credential Management
- Define: Session lifecycle — creation, duration, expiry, invalidation triggers
- Specify: MFA considerations — when required, which factors, fallback if unavailable
- Clarify: Credential storage policy — where stored, rotation expectations
- Confirm: Get user agreement

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Authorization & Access Control

#### 2.1 Authorization Model
- Define: Authorization approach — RBAC, ABAC, policy-based, or hybrid
- Identify: Principal types and their role/attribute dimensions
- Specify: Permission boundaries — what each principal can read, write, execute, delete
- Review: Discuss with user

#### 2.2 Resource-Level Access
- Identify: Resources requiring access control (e.g., user data, admin functions, cross-tenant data)
- Define: Ownership and delegation rules — who can grant access to whom
- Clarify: Privilege escalation policy — how elevated access is requested and approved
- Confirm: Get user agreement

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Data Protection Design

#### 3.1 Data Classification
- Identify: Data categories and their sensitivity level (public, internal, confidential, restricted)
- Map: Where each data category is stored, transmitted, and processed
- Define: Protection requirements per classification tier
- Review: Discuss with user

#### 3.2 Encryption & PII Handling Policy
- Define: Encryption scope — which data requires protection at rest vs. in transit
- Specify: PII inventory — what constitutes personal data in this system
- Clarify: PII handling policy — collection minimization, access control, masking in logs and outputs
- Define: Data lifecycle — archival, deletion, and anonymization expectations
- Confirm: Get user agreement

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Privacy & Compliance Design

#### 4.1 Assess Necessity
- Analyze: Determine if the system handles personal data or is subject to regulatory requirements
- Present: Explain whether privacy/compliance design is needed with rationale
- Decide: Skip to Step 5 if no personal data handling and no regulatory requirements
- Confirm: Get user agreement

#### 4.2 Privacy by Design Principles (if proceeding)
- Define: Data minimization approach — collect only what is necessary for the stated purpose
- Specify: Default privacy stance — what is off by default, what requires explicit opt-in
- Clarify: User rights handling — access requests, correction, portability, erasure
- Review: Discuss with user

#### 4.3 Consent & Retention Policy (if proceeding)
- Define: Consent model — what requires user consent, how it is recorded and withdrawn
- Specify: Data retention periods per data type — when data expires and how it is purged
- Identify: Applicable regulatory frameworks (GDPR, PIPA, CCPA, HIPAA, etc.) and their key design constraints
- Confirm: Get user agreement

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Threat Modeling (if applicable)

#### 5.1 Assess Necessity
- Analyze: Determine if formal threat modeling is warranted given system exposure and data sensitivity
- Present: Explain whether threat modeling is needed (may not apply to internal/low-risk systems)
- Decide: Skip to Step 6 if system is internal-only with no sensitive data and no external attack surface
- Confirm: Get user agreement

#### 5.2 Attack Surface Analysis (if proceeding)
- Identify: External entry points — APIs, user inputs, file uploads, third-party integrations
- Map: Trust boundaries — where data crosses from untrusted to trusted zones
- Clarify: High-value targets — which assets are most attractive to attackers
- Review: Discuss with user

#### 5.3 Threat Identification & Mitigation Strategy (if proceeding)
- Identify: Key threat scenarios relevant to the system (e.g., credential stuffing, data exfiltration, privilege escalation)
- Define: Mitigation approach for each identified threat — at policy/architecture level, not implementation detail
- Specify: Residual risk acceptance — threats acknowledged but not mitigated, with rationale
- Confirm: Get user agreement

#### Checkpoint: Step 5 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 6: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: Security / Privacy Complete
- Announce: "Security / Privacy complete. Proceeding to next selected Design Area: [next area name]."

## Output Template

> This is a recommended template. Adapt sections, ordering, and detail level to your project's needs.

```markdown
# [Project Name] - Security / Privacy

> **Area**: Security / Privacy
> **Last Updated**: [Date]

## Authentication & Identity

### Authentication Strategy
[Authentication method, identity provider, session management]

### Multi-Factor Authentication (if applicable)
[MFA approach, recovery strategy]

## Authorization & Access Control

### Authorization Model
[RBAC / ABAC / hybrid — with justification]

### Permission Matrix
| Role | Resource | Create | Read | Update | Delete |
|------|----------|--------|------|--------|--------|
| [e.g., Admin] | [e.g., User accounts] | ✓ | ✓ | ✓ | ✓ |

## Data Protection

### Data Classification
| Classification | Examples | Protection Level | Encryption |
|---------------|----------|-----------------|------------|
| [e.g., Sensitive PII] | [e.g., SSN, health data] | [e.g., High] | [e.g., At rest + in transit] |

### PII Handling
[Anonymization, pseudonymization, masking strategies]

## Privacy & Compliance (if applicable)

### Regulatory Requirements
[Applicable regulations, compliance scope]

### Consent Management
[Consent collection, storage, withdrawal mechanism]

### Data Retention & Deletion
[Retention periods by data type, deletion procedures]

## Threat Model (if applicable)

### Attack Surface
[Identified attack vectors, risk levels]

### Mitigation Strategy
[Key mitigations mapped to threats]

## Records
[Decision records created during this area]
```
