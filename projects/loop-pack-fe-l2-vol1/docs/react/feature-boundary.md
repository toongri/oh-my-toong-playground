# 피처 경계·cross-feature 공유

피처끼리 직접 import하지 않는다(depcruise 강제). 여러 피처가 뭔가를 함께 써야 할 때 세 갈래로 판단한다.

## 공유 3분기

**① 타입·순수 유틸(도메인 로직) → `shared`로 내린다**
가격 포맷·재고 판정·공용 도메인 타입처럼 특정 피처 소유가 아닌 것. 한 피처에 두고 옆 피처가 꺼내 쓰면(cross-feature) 소유가 불명확해지고 테스트 격리가 깨진다. 공용 조각을 `shared`로 내려 둘 다 거기 의존하게 한다.

- 공유 O: 타입, 순수 함수(계산·포맷·검증)
- 공유 X: 피처의 상태·컴포넌트·훅 (그건 ② 또는 ③)

**② 여러 피처의 UI를 함께 배치 → 상위(`app`)에서 조립**
피처는 서로를 모른 채, 상위가 데이터·콜백을 넘겨 배선한다.

```tsx
// ✗ featureA 안에서 import { Cart } from '../cart'  (cross-feature)
// ✓ app이 조립, 각 피처는 props로만 소통
function Page() {
  const [selected, setSelected] = useState<Product | null>(null);
  return (
    <>
      <ProductList onSelect={setSelected} />
      <Cart product={selected} />
    </>
  );
}
```

넘기는 수단: props · named slot · DI(context/props 주입).

**③ 두 피처가 늘 함께 바뀜 → 하나로 병합**
매번 같이 수정되면 경계가 틀린 것. 분리를 고집하지 말고 합친다.

## 이벤트버스

조립·DI로 풀기 어려운 경우(다대다 비동기 알림 등)에만 쓴다. 남용하면 누가 뭘 듣는지 추적이 어려워져 숨긴 결합을 런타임으로 옮길 뿐이다.

## 근거

- Feature-Sliced Design (public API·상위 조립): https://feature-sliced.design/docs/reference/public-api
- bulletproof-react ("compose features at the application level"): https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
