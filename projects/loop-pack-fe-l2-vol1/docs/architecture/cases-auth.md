# 인증 하나를 전 레이어로 나누기

로그인 폼 하나도 위치·검증·토큰 저장·로그아웃까지 나누면 최소 네 번의 배치 결정을 거친다. 각 결정은 서로 다른 축으로 판단하고, 어느 하나도 "인증이니까 App에 둔다"처럼 한 번에 끝나지 않는다.

## 로그인/회원가입 폼의 위치

**상황.** 로그인 폼을 만들 때 처음부터 `features/sign-in`, `features/sign-up`으로 나눠 시작하고 싶어진다 — "인증은 어디서나 재사용되는 로직"이라는 직감 때문이다.

```text
❌ features/sign-in/ui/SignInForm.tsx     ← 소비자는 아직 pages/login 하나뿐
❌ features/sign-up/ui/SignUpForm.tsx     ← 소비자는 아직 pages/register 하나뿐
```

**판단 과정.** [`./layers.md`](./layers.md)의 pages-first 규칙을 그대로 적용한다 — 실 소비자가 하나뿐인데 레이어부터 만드는 것은 overslicing이다. 로그인 폼은 보통 단순해서 segment로 쪼갤 필요조차 없고, 로그인·회원가입은 외형이 비슷해 한 Page slice 안에 같이 둘 수 있다. 판단축은 **재사용 범위**다 — 앱의 여러 화면에서 다이얼로그로 뜬다면(예: 장바구니에 담다가, 리뷰를 쓰다가 로그인을 요구하는 모달) 그때는 `pages/login` 하나로 묶기 어렵고, 여러 소비자가 공유하는 독립 UI 블록이 된다.

```text
✅ pages/login/
   ├── ui/LoginForm.tsx
   ├── ui/RegisterForm.tsx     ← 외형이 비슷해 같은 slice에 둔다
   └── model/registration-schema.ts

✅ (다이얼로그로 여러 화면에서 뜨는 경우에만)
   widgets/login-dialog/
   ├── ui/LoginDialog.tsx
   └── model/registration-schema.ts
```

한 화면에서만 쓰이면 `pages/login`, 여러 화면이 다이얼로그로 공유하면 `widgets/login-dialog` — 승격 조건은 "인증이라서"가 아니라 [`./placement.md`](./placement.md)의 다섯 질문 중 1번("현재 독립 소비자는 몇 개인가")이다.

## 폼 검증 스키마 — model 세그먼트

**상황.** 비밀번호 확인 검증을 어디에 둘지 애매하다. `ui/RegisterForm.tsx` 안에 인라인으로 넣고 싶어진다.

```tsx
// ❌ pages/login/ui/RegisterForm.tsx — 검증 규칙이 컴포넌트 안에 흩어짐
function RegisterForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordsMatch = password === confirmPassword; // 컴포넌트를 열어야만 규칙이 보인다
  // ...
}
```

**판단 과정.** 검증 규칙은 UI가 아니라 비즈니스 로직이다 — [`./layers.md`](./layers.md)가 정의하는 segment 기준대로 `model`이 소유한다. 컴포넌트는 그 스키마를 소비할 뿐이다.

```typescript
// ✅ pages/login/model/registration-schema.ts
import { z } from "zod";

export const registrationSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "비밀번호가 일치하지 않습니다",
    path: ["confirmPassword"],
  });
```

```tsx
// ✅ pages/login/ui/RegisterForm.tsx — 규칙은 model에서 가져와 쓰기만 한다
import { registrationSchema } from "../model/registration-schema";

function RegisterForm() {
  const form = useForm({ resolver: zodResolver(registrationSchema) });
  // ...
}
```

## 토큰 저장 — 세 옵션과 트레이드오프

**상황.** 로그인 성공 후 access token을 어디에 둘지가 인증 분해에서 가장 자주 막히는 지점이다. FSD 공식 인증 가이드도 이 지점에서 하나의 정답을 강제하지 않고 옵션과 트레이드오프를 제시한다 — 그 구조를 그대로 따르는 것이 오히려 판단을 돕는다.

**흔한 실수.** 정답을 못 찾아 토큰을 Page 로컬 상태로 들고, 필요한 하위 컴포넌트마다 props로 뚫어 내린다.

```tsx
// ❌ pages/login/ui/LoginPage.tsx — 토큰이 Page 로컬 상태 → prop drilling
function LoginPage() {
  const [token, setToken] = useState<string | null>(null);
  return (
    <Layout>
      <Header token={token} />
      <Content token={token} onLogin={setToken} />
    </Layout>
  );
}
// LoginPage 밖(다른 화면)에서는 이 token에 접근할 방법이 없다
```

**판단 과정 — 세 옵션.**

| 옵션 | 위치 | 장점 | 문제 |
| --- | --- | --- | --- |
| A | `shared/api` | 다른 요청 함수 어디서나 자유롭게 사용 가능 | 토큰 관리·갱신 로직을 전담하는 위치가 없다 |
| B | `entities/user`(또는 `currentUser`)의 `model` | 도메인 관점에서 명확 — "로그인한 사용자"의 속성이다 | 상위 레이어가 하위 slice의 상태에 접근해야 하는 문제가 남는다 — 수동 전달(비권장), 토큰 키는 `shared/api`에 두고 App에서 context provider로 연결(권장이지만 App이 Entity 내부를 암묵적으로 알게 된다), 또는 구독 주입 중 택일 |
| C | Pages/Widgets | 구현이 당장 쉽다 | 앱 전체 상태를 지역 레이어에 두는 것 — 명시적으로 비권장 |

옵션 C는 위 ❌ 코드가 왜 틀렸는지를 그대로 설명한다 — 로그인 여부는 앱 전체가 공유하는 상태인데, 그 원본을 Page 하나에 가두면 다른 화면은 접근할 방법이 없다.

**해소.** 이 프로젝트 규모에서는 옵션 B를 App의 context provider로 연결하는 편이 실용적이다 — 토큰 키 상수는 `shared/api`에 두고, 실제 인증 상태는 `entities/user/model`이 소유하며, App은 그 provider를 조립만 한다.

```typescript
// ✅ shared/api/token.ts — 토큰 키·저장 위치만 안다, 갱신 로직은 모른다
export const ACCESS_TOKEN_KEY = "access_token";
```

```typescript
// ✅ entities/user/model/auth-store.ts — 인증 상태의 원본
import { ACCESS_TOKEN_KEY } from "@/shared/api/token";

export const useAuthStore = create<AuthState>((set) => ({
  // 새로고침 후에도 인증 상태가 유지되려면 저장된 토큰으로 초기화한다.
  // SSR에는 localStorage가 없으므로 window 가드 필수 — 서버 렌더는 null로 시작한다.
  token: typeof window !== "undefined" ? localStorage.getItem(ACCESS_TOKEN_KEY) : null,
  setToken: (token: string) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    set({ token });
  },
  clearToken: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    set({ token: null });
  },
}));
```

```tsx
// ✅ _app/providers/AuthProvider.tsx — App은 조립만, 로직은 entity가 소유
import { useAuthStore } from "@/entities/user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return <AuthContext.Provider value={{ token }}>{children}</AuthContext.Provider>;
}
```

서버 렌더(null)와 클라이언트 초기값(저장된 토큰)이 달라지는 hydration mismatch는 이 방식의 알려진 비용이다 — 이 비용까지 사라지는 것이 아래 쿠키 대안의 근거 중 하나다.

**이상적인 대안은 쿠키다.** httpOnly 쿠키로 토큰을 관리하면 프론트엔드 아키텍처 측면에서는 거의 고려가 필요 없어진다 — 브라우저와 서버가 자동으로 주고받으므로 위 세 옵션 중 어디에 둘지 자체가 질문이 아니게 된다. 세 옵션 트레이드오프는 클라이언트가 토큰을 직접 들고 있어야 하는 상황(SPA + 별도 API 서버 등)에 한정된다.

## 로그아웃 처리 위치

**상황.** 로그아웃 버튼을 헤더에 두고 클릭 핸들러 안에서 바로 스토리지를 지운다.

```tsx
// ❌ widgets/header/ui/Header.tsx — 로그아웃 로직이 UI 컴포넌트에 인라인
function Header() {
  const handleLogout = () => {
    localStorage.removeItem("access_token"); // entities/user의 원본과 별개로 지움
    window.location.reload();
  };
  return <button onClick={handleLogout}>로그아웃</button>;
}
// entities/user의 auth-store는 그대로 token을 들고 있다 — 원본이 둘로 갈라진다
```

**판단 과정.** 위치는 API 요청이 어디 몰려 있는지로 정한다 — API 요청이 `shared/api`에 몰려 있으면 로그인 함수 옆에 로그아웃 함수를 둔다. 그렇지 않다면 로그아웃 버튼이 있는 위젯(대개 헤더)의 `api`/`model` 세그먼트가 소유한다. 어느 쪽이든 토큰 상태를 실제로 바꾸는 함수는 하나로 모으고, UI는 그 함수를 호출만 한다.

```typescript
// ✅ widgets/header/model/use-logout.ts — 헤더가 로그아웃 흐름을 소유
import { useAuthStore } from "@/entities/user";
import { logoutRequest } from "@/shared/api/auth";

export function useLogout() {
  const clearToken = useAuthStore((s) => s.clearToken);
  return async () => {
    try {
      await logoutRequest();
    } finally {
      // 로그아웃 요청이 실패해도 클라이언트 토큰은 반드시 지운다 — failsafe
      clearToken();
    }
  };
}
```

```tsx
// ✅ widgets/header/ui/Header.tsx — UI는 훅을 호출만 한다
function Header() {
  const logout = useLogout();
  return <button onClick={logout}>로그아웃</button>;
}
```

**failsafe는 선택이 아니다.** 로그아웃 요청 실패나 토큰 갱신(refresh) 실패 시에도 클라이언트 쪽 토큰은 반드시 지워야 한다 — 서버 응답을 기다리다 실패하면 사용자는 로그아웃 버튼을 눌렀는데도 로그인 상태로 남는다. `finally` 블록으로 클라이언트 정리를 요청 성패와 분리하는 이유가 이것이다.

## 이 분해가 통과한 것

위 네 결정 — 폼 위치, 검증 스키마, 토큰 저장, 로그아웃 — 은 모두 [`./placement.md`](./placement.md)의 다섯 질문(소비자 수, 변경 이유, public API, import 방향, Page에 남길 때의 구체적 문제)을 하나씩 통과한 결과다. "인증"이라는 도메인 이름 하나로 레이어가 정해지지 않는다는 점이 이 케이스의 핵심이다 — 같은 이름 아래에서도 폼은 Page, 검증은 Page의 model, 토큰은 Entity+Shared+App의 조합, 로그아웃은 소비자 위젯이 각각 다른 답을 낸다.

## 근거

- [FSD — Authentication example](https://feature-sliced.design/docs/guides/examples/auth)
- [FSD — Layers](https://feature-sliced.design/docs/reference/layers)
- [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)
- [FSD — Public API](https://feature-sliced.design/docs/reference/public-api)
