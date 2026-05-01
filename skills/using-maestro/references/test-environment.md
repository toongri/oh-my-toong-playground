# Test Environment — Category-Driven Defaults

> Status checked: 2026-05-01. Capability boundaries shift with Xcode/Android Studio releases — verify per current SDK docs before relying on specifics.

이 reference는 **두 카테고리**로 시작한다. 어느 카테고리인지가 default 환경(emulator/simulator vs physical device)을 결정한다.

## Category A — Software application (consumer / business app)

**기본은 에뮬레이터/시뮬레이터다.** OS-supplied UI 위에서 동작하는 일반 모바일 앱이라면 별도 판단 없이 이 default를 따른다.

| 이유 | 효과 |
|---|---|
| 병렬화 | 한 머신에서 여러 인스턴스를 띄워 flow 동시 실행 가능 — CI throughput 확장 (host 자원 contention 한계 안에서) |
| 환경 격리 | 개발자/QA의 실기기 알림·로그인 상태·네트워크 변동에 영향 받지 않음. 매 실행이 동일한 cold state에서 시작 |
| 속도 | snapshot 부팅, USB/WiFi ADB 페어링 단계 없음 |
| 가용성 | OS 버전·해상도 프로파일 즉시 전환, 실기 fleet 유지 비용 없음 |
| 상태 변수 감소 | hardware throttling·배터리 잔량·주변 센서 노이즈 부재 → flake 변수 감소 (단 host 자원 경합은 여전) |

## Category B — Hardware-integrated SUT (kiosk / IoT / medical device)

**물리 기기가 SUT 그 자체다.** 위 default는 적용되지 않는다 — 에뮬레이터로는 그 SUT를 검증할 수 없다. 시나리오 설계는 [`scenario-design.md`](scenario-design.md), MCP vs CLI 결정은 [`ai-agent-integration.md`](ai-agent-integration.md) Decision Matrix 참조. 이 reference의 나머지 섹션(Limits, Decision Rule)은 Category A 안에서만 의미를 가진다.

## Category A의 Limits — 에뮬레이터에서 부정확하거나 불완전한 영역

특정 능력이 flow의 검증 대상이라면 그 flow에 한해 실기기를 명시적으로 요구한다. capability 단위 결정이지 카테고리 단위 결정이 아니다.

| 영역 | 한계 |
|---|---|
| ABI / native module 적합성 | React Native JSI / Turbomodule / 제조사 native SDK가 ARM↔x86 차이로 emulator/simulator에서 통과해도 실기에서 crash 가능. 빌드 fingerprint가 다름 |
| 카메라 / 마이크 / 센서 | emulator도 일부(위치, 모션, 지문 입력 등) 시뮬 가능. **실제 광학 입력, 마이크 audio fidelity, 진짜 GPS fix는 physical 전용** |
| BLE / NFC / USB peripheral | 미지원 또는 제한적 시뮬에 그침 |
| 생체 인증 | UI flow까지는 emulator/simulator도 검증 가능. **secure-enclave attestation, 실제 등록(enrollment), 하드웨어 인증 흐름은 physical 전용** |
| 푸시 알림 | iOS Simulator는 Xcode 11.4+에서 `.apns` payload push 지원. **production APNs 전송, Doze/low-power 하 silent push 신뢰성, entitlement-gated 분기는 physical 필요** |
| 결제 (Apple Pay / Google Pay) | sandbox는 emulator 가능. **production 결제 회귀는 physical 전용** |
| Manufacturer SDK / DRM / attestation | Widevine L1, Play Integrity / SafetyNet, Samsung Knox 등 device attestation 의존 모듈 |
| Deep link / Universal Link / App Link | domain association 검증, provisioning profile 차이로 실기와 다르게 동작. iOS Simulator universal link 처리에 일부 갭 존재 |
| Real network conditions | cellular handoff, captive portal, IPv6-only 환경 — emulator의 네트워크 throttling은 합성 데이터 |
| 성능 / 배터리 / 발열 | Maestro의 correctness 검증 대상이 아님. emulator는 host 자원 공유 → 측정 의미 없음 (이 행은 AI/사람의 오용을 막기 위한 명시) |

iOS Keychain accessibility 차이는 별도 표가 아니라 [`test-isolation-and-reset.md`](test-isolation-and-reset.md) 의 reset/state-isolation 컨텍스트로 다룬다 — capability 한계라기보다 state-isolation 이슈에 가깝다.

## Maestro 자체의 환경 제약

- **Maestro Android** — emulator + physical 모두 지원.
- **Maestro iOS** — **simulator 중심**. iOS 실기 지원은 historically 제한적이다. Category A 안에서도 iOS physical-only 능력(예: 위 Limits 다수)이 검증 대상이라면 Maestro만으로는 한계가 있고 XCUITest 등 보완 도구를 병행할지 별도 결정 필요.

## Decision Rule

1. **SUT 분류** — Category A인지 B인지 먼저 판별. project-local SKILL.md 또는 `flow_dir` config가 이를 지시할 수 있음.
2. **Category A 진입** — emulator/simulator profile 1개를 reference로 고정하고 시작.
3. **Visual regression baseline** — emulator든 physical이든 **한 종류 + 한 프로파일**에 고정. cross-profile baseline 금지 규칙은 [`storage-and-screenshots.md`](storage-and-screenshots.md) 참조.
4. **Capability override** — Limits 표 항목이 flow의 검증 대상이면 그 flow에 한해 physical 요구. tag로 격리(예: `device:physical-required`) 후 CI에서 별도 stage로 라우팅. cadence(nightly/pre-release/on-merge)는 팀 결정 — 본 skill 범위 외.

## Orthogonality

이 가이드는 **device-target 축**(emulator vs physical)에 관한 것이다. **tooling-channel 축**(MCP vs CLI, [`ai-agent-integration.md`](ai-agent-integration.md))과 직교한다. "kiosk physical + CLI", "consumer emulator + MCP", "consumer physical + CLI" 같은 조합이 모두 가능하다. 두 axis를 병합하지 말 것.

## How this list ages

emulator/simulator 능력은 매 Xcode / Android Studio / Maestro 릴리스마다 확장된다. 위 Limits 표의 specific 행(특히 push, biometric, payment, deep link)은 시간이 지나면 narrow된다. version-named feature 표현 대신 capability 카테고리(예: "secure-enclave attestation")를 쓴 이유. 의존하기 전에 현재 Maestro/SDK 문서 확인 권장.
