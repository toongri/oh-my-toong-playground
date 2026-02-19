> this is example
---
## 📌 Summary
이번 PR은 **도메인 간 강한 결합 문제**와 **Application 레이어의 과도한 책임 집중 문제**를 해결하기 위해 이벤트 기반 아키텍처를 도입하고, 레이어별 책임을 명확히 분리했습니다.

**주요 변경사항:**
- **이벤트 기반 아키텍처 도입**: Command와 Event를 기준으로 주문-결제 플로우를 느슨하게 연결하여 도메인 간 의존성을 제거했습니다. 재고 차감은 즉시 정합성이 필요하므로 동일 트랜잭션에서 처리하고, 쿠폰/포인트/결제는 이벤트를 통해 비동기적으로 처리하도록 설계했습니다.
- **레이어별 책임 분리**: Event는 도메인 레이어에, EventHandler는 Application 레이어에, EventPublisher 구현체는 Infrastructure 레이어에 배치하여 각 레이어의 책임을 명확히 했습니다.
- **보상 트랜잭션 구현**: 결제 실패 시 재고와 포인트를 원복하는 보상 트랜잭션을 추가하고, 멱등성 보장과 Deadlock 방지를 위한 동시성 제어를 적용했습니다.
- **Application 레이어 리팩토링**: payment 도메인을 분리하고, 도메인별 Application 서비스로 통합하여 Facade는 여러 도메인 조합만 담당하도록 개선했습니다. 또한 DIP를 준수하여 Application 레이어가 Infrastructure를 직접 의존하지 않도록 개선했습니다.

멘토링 시간때 피드백해주신 도메인 레이어에서 이벤트 발행하도록 처리하는 것, 어플리케이션 레이어에 이벤트 리스너를 두는 것, 이벤트 핸들러를 하나의 클래스로 구현하는 것 등은 시간이 부족하여 이번 PR에는 반영하지 못했습니다. 부족한 점 보완하여 다음주 PR에 포함하겠습니다.

## 💬 Review Points

###  1. 이벤트 기반 아키텍처 도입

주문, 좋아요처럼 여러 도메인의 서비스를 직접 의존하던 구조를 Command와 Event를 기준으로 나누어 느슨하게 연결되도록 수정했습니다. 이벤트 기반 아키텍처는 이미 일어난 사실(Event)을 중심으로 도메인 간 협업을 구성함으로써, 각 도메인이 다른 도메인의 내부 구현에 의존하지 않고도 필요한 정보를 전달받을 수 있어 도메인간 의존성을 없앨 수 있었습니다.

#### 1) Command와 Event 기반 설계

도메인별로 주문 생성, 쿠폰 적용, 포인트 차감, 결제 요청, 좋아요 등 시스템에서 수행될 수 있는 주요 **Command**(사용자의 의도)를 식별하고, 각 Command가 실행되었을 때 **Event**(이미 일어난 사실)들을 도출했습니다.

이후 Event별로 어떤 도메인이 관심을 가지는지를 기준으로 후속 Command를 연결하여, 주문 생성 흐름을 다음과 같은 이벤트 기반 협업 구조로 정리했습니다:

```
CreateOrderCommand (PurchasingFacade.createOrder)
   ↓
 OrderCreatedEvent 발행 (OrderService.create)
   ↓
 [ProductEventHandler] 재고 차감 (BEFORE_COMMIT)
 [CouponEventHandler] 쿠폰 적용 (AFTER_COMMIT)
 [PointEventHandler] 포인트 차감 (AFTER_COMMIT)
 [PurchasingFacade] PaymentEvent.PaymentRequested 발행 (AFTER_COMMIT)
 [PaymentEventHandler] Payment 생성 및 PG 결제 요청 (AFTER_COMMIT)
```

#### Before: 도메인 간 직접 의존

```java
// PurchasingFacade.java
@Component
public class PurchasingFacade {
    private final UserService userService;
    private final CouponService couponService;
    private final PaymentService paymentService;
    private final OrderService orderService;

    @Transactional
    public OrderInfo createOrder(...) {
        // 주문 생성
        Order order = orderService.create(...);

        // 쿠폰 적용 (직접 호출)
        couponService.applyCoupon(userId, couponCode, subtotal);

        // 포인트 차감 (직접 호출)
        userService.deductPoint(userId, usedPoint);

        // 결제 요청 (직접 호출)
        paymentService.requestPayment(...);

        // 주문 도메인이 다른 도메인의 내부 규칙에 개입
    }
}
```

**문제점:**
- 주문 도메인이 쿠폰, 포인트, 결제 도메인의 내부 규칙에 직접 개입
- 도메인 간 강한 결합으로 인한 변경 영향도 증가
- 트랜잭션 경계가 모호함
- 각 도메인이 독립적으로 동작하기 어려움

#### After: 이벤트 기반 협업 구조

```java
// application/order/OrderService.java
@Service
public class OrderService {
    private final OrderEventPublisher orderEventPublisher;

    @Transactional
    public Order create(CreateOrderCommand command) {
        Order order = Order.of(command.userId(), command.items(), command.couponCode(), 0);
        Order savedOrder = orderRepository.save(order);

        // ✅ OrderCreatedEvent 발행 (이미 일어난 사실)
        orderEventPublisher.publish(OrderEvent.OrderCreated.from(savedOrder, command.subtotal(), command.usedPointAmount()));

        return savedOrder;
    }
}

// application/coupon/CouponEventHandler.java
@Component
public class CouponEventHandler {
    private final CouponService couponService;

    @Transactional
    public void handleOrderCreated(OrderEvent.OrderCreated event) {
        // ✅ OrderCreatedEvent를 구독하여 쿠폰 적용 Command 실행
        if (event.couponCode() != null) {
            couponService.applyCoupon(
                new ApplyCouponCommand(event.userId(), event.couponCode(), event.subtotal())
            );
        }
    }
}

// application/user/PointEventHandler.java
@Transactional
public void handleOrderCreated(OrderEvent.OrderCreated event) {
    // ✅ OrderEvent.OrderCreated를 구독하여 포인트 차감 Command 실행
    if (event.usedPointAmount() == null || event.usedPointAmount() == 0) {
        return;
    }
    DeductPointCommand command = new DeductPointCommand(event.userId(), event.usedPointAmount());
    user.deductPoint(Point.of(command.usedPointAmount()));
    userService.save(user);
}

// application/payment/PaymentEventHandler.java
@Component
public class PaymentEventHandler {
    private final PaymentService paymentService;

    @Transactional
    public void handlePaymentRequested(PaymentEvent.PaymentRequested event) {
        // ✅ PaymentRequestedEvent를 구독하여 결제 요청 Command 실행
        Payment payment = paymentService.create(...);
        // 결제 처리 로직...
    }
}
```

**개선 효과:**
- 도메인 간 느슨한 결합: 주문 도메인이 다른 도메인의 내부 규칙에 개입하지 않음
- 트랜잭션 경계 명확화: 각 도메인이 자신의 트랜잭션 경계 내에서 동작
- 독립적인 동작: 각 도메인이 자신의 규칙에 따라 독립적으로 동작
- 확장성 향상: 새로운 도메인 추가 시 이벤트만 구독하면 됨

#### 2) 재고 차감은 즉시 처리

재고는 주문 생성과 동시에 차감되어야 하며, 주문이 취소되면 즉시 원복되어야 하는 즉시 정합성이 필요한 영역입니다. 반면 쿠폰, 포인트, 결제는 주문 생성 후 일정 시간 내에 처리되면 되는 최종 일관성으로 충분합니다.

따라서 재고 차감은 주문 생성과 동일한 트랜잭션에서 처리하고, 나머지는 이벤트를 통해 비동기적으로 처리하도록 설계했습니다.

```java
// application/product/ProductEventHandler.java
@Component
public class ProductEventHandler {
    private final ProductService productService;

    @Transactional
    public void handleOrderCreated(OrderEvent.OrderCreated event) {
        // ✅ 재고 차감은 즉시 정합성이 필요하므로 동일 트랜잭션에서 처리
        for (OrderEvent.OrderCreated.OrderItemInfo itemInfo : event.orderItems()) {
            Product product = productService.getProductForUpdate(itemInfo.productId());
            DeductStockCommand command = new DeductStockCommand(itemInfo.productId(), itemInfo.quantity());
            product.decreaseStock(command.quantity());
        }
        productService.saveAll(...);
    }
}
```

#### 3) 이벤트 기반 흐름 예시

주문 생성부터 완료까지의 이벤트 기반 흐름:

```
1. CreateOrderCommand
   ↓
2. OrderCreatedEvent 발행
   ↓
3. [ProductEventHandler] DeductStockCommand (재고 차감)
   ↓
4. [CouponEventHandler] ApplyCouponCommand → CouponAppliedEvent
   ↓
5. [PointEventHandler] DeductPointCommand (포인트 차감)
   ↓
6. [PaymentEventHandler] RequestPaymentCommand → PaymentRequestedEvent
   ↓
7. [OrderEventHandler] OrderCompletedEvent (결제 완료 시)
```

**핵심 원칙:**
- **Command**: 사용자의 의도 (CreateOrder, ApplyCoupon, DeductPoint, RequestPayment 등)
- **Event**: 이미 일어난 사실 (OrderCreated, CouponApplied, PaymentRequested 등)
- 각 도메인은 자신이 관심 있는 Event를 구독하여 후속 Command를 실행
- 재고처럼 즉시 정합성이 필요한 영역만 동일 트랜잭션에서 처리
---

### 2. 이벤트 관련 로직들의 레이어별 배치

각 이벤트는 도메인에 대한 규칙을 표현하는 것이기 때문에 domain 레이어에 event를 넣고, 어플리케이션 레이어에서 event handler가 어플리케이션 서비스를 사용하는 방식으로 레이어를 분리했습니다.
```java
// domain/order/OrderEvent.java - 도메인 레이어에 Event 정의
public class OrderEvent {
    public record OrderCreated(
        Long orderId,
        String userId,
        List<OrderItemInfo> orderItems,
        Long subtotal,
        Long usedPointAmount,
        String couponCode
    ) {
        public static OrderCreated from(Order order, Long subtotal, Long usedPointAmount) {
            // 도메인 규칙을 표현하는 Event
            return new OrderCreated(...);
        }
    }
}

// application/order/OrderService.java - Application 레이어
@Service
public class OrderService {
    private final OrderEventPublisher orderEventPublisher;  // ✅ 도메인 인터페이스에 의존

    @Transactional
    public Order create(CreateOrderCommand command) {
        Order order = Order.of(...);
        Order savedOrder = orderRepository.save(order);

        // ✅ 도메인 Event 발행
        orderEventPublisher.publish(OrderEvent.OrderCreated.from(savedOrder, ...));

        return savedOrder;
    }
}

// application/coupon/CouponEventHandler.java - Application 레이어
@Component
public class CouponEventHandler {
    private final CouponService couponService;  // ✅ Application 서비스 사용

    @Transactional
    public void handleOrderCreated(OrderEvent.OrderCreated event) {
        // ✅ Event Handler가 Application 서비스를 사용
        couponService.applyCoupon(
            new ApplyCouponCommand(event.userId(), event.couponCode(), event.subtotal())
        );
    }
}
```
또한 event publisher는 DIP를 적용하여 도메인 레이어에 interface를, infrastructure 레이어에 구현체를 두는 방식으로 구현했습니다.
```java
// domain/payment/PaymentEventPublisher.java - 도메인 레이어에 인터페이스 정의
public interface PaymentEventPublisher {
    void publish(PaymentEvent event);
}

// infrastructure/payment/PaymentEventPublisherImpl.java - Infrastructure 레이어
@Component
public class PaymentEventPublisherImpl implements PaymentEventPublisher {
    private final ApplicationEventPublisher applicationEventPublisher;

    @Override
    public void publish(PaymentEvent event) {
        // ✅ Infrastructure에서 실제 이벤트 발행 구현
        applicationEventPublisher.publishEvent(event);
    }
}
```
그리고 event listener는 이벤트 핸들러를 호출하는 역할만 하므로 interface 레이어에 두었습니다.
```java
// interface/event/PaymentEventListener.java - Interface 레이어
@Component
public class PaymentEventListener {
    private final PaymentEventHandler paymentEventHandler;  // ✅ Event Handler 호출만 담당

    @EventListener
    public void handle(PaymentEvent event) {
        paymentEventHandler.handle(event);
    }
}
```
**레이어별 책임:**
- **Domain 레이어**: Event 정의 (도메인 규칙 표현), EventPublisher 인터페이스 정의
- **Application 레이어**: Event Handler 구현 (Application 서비스 사용)
- **Infrastructure 레이어**: EventPublisher 구현체 (실제 이벤트 발행 기술 구현)
- **Interface 레이어**: Event Listener (이벤트 핸들러 호출 역할만 담당)

**개선 효과:**
- 도메인 규칙을 표현하는 Event가 도메인 레이어에 위치하여 응집도 향상
- DIP 준수: EventPublisher 인터페이스를 도메인 레이어에 정의하여 인프라 의존성 제거
- 레이어별 책임이 명확히 분리되어 유지보수성 향상
- Event Listener는 단순히 핸들러를 호출하는 역할만 담당하여 단순성 유지

---
### 3. 구매 실패 전략 (보상 트랜잭션)
이벤트 기반 아키텍처를 도입하면서 각 도메인이 독립적인 트랜잭션으로 동작하게 되었습니다. 이로 인해 결제 실패 시 이미 차감된 재고와 포인트를 원복해야 하는 문제가 발생했습니다. 이 문제를 해결하기 위해 보상 트랜젝션을 추가하였습니다.

#### 1) 결제 실패 흐름
결제 실패 시 보상 트랜잭션을 통해 리소스를 원복합니다:
```
PaymentFailed 이벤트 발행
    ↓
OrderEventHandler.handlePaymentFailed()
    ↓
OrderService.cancelOrder()
    ↓
OrderCanceled 이벤트 발행
    ↓
┌─────────────────────────┬─────────────────────────┐
│ ProductEventHandler     │ PointEventHandler       │
│ handleOrderCanceled()   │ handleOrderCanceled()   │
│ 재고 원복                │ 포인트 환불              │
└─────────────────────────┴─────────────────────────┘
```

#### 2) 결제 실패 처리 구현
이벤트 기반 시스템에서는 네트워크 오류, 재시도 등으로 인해 동일한 이벤트가 여러 번 처리될 수 있습니다. 멱등성을 보장하지 않으면 재고가 중복으로 원복되거나 포인트가 중복으로 환불될 수 있습니다. 그래서 아래와 같이 멱등성을 보장하도록 구성했습니다.
```java
// OrderEventHandler.java
@Transactional
public void handlePaymentFailed(PaymentEvent.PaymentFailed event) {
    Order order = orderService.getOrder(event.orderId()).orElse(null);
    if (order == null) {
        log.warn("결제 실패 이벤트 처리 시 주문을 찾을 수 없습니다. (orderId: {})", event.orderId());
        return;
    }

    // ✅ 멱등성 보장: 이미 취소된 주문인 경우 처리하지 않음
    if (order.isCanceled()) {
        log.debug("이미 취소된 주문입니다. 상태 업데이트를 건너뜁니다. (orderId: {})", event.orderId());
        return;
    }

    // ✅ 주문 취소 (OrderCanceled 이벤트 발행 포함)
    // PaymentFailed 이벤트에 포함된 refundPointAmount 사용
    orderService.cancelOrder(event.orderId(), event.reason(), event.refundPointAmount());
    log.info("결제 실패로 인한 주문 취소 완료. (orderId: {}, reason: {}, refundPointAmount: {})",
            event.orderId(), event.reason(), event.refundPointAmount());
}
```

#### 3) 리소스 원복 처리
여러 도메인이 동시에 리소스를 원복할 때, 서로 다른 순서로 락을 획득하면 Deadlock이 발생할 수 있습니다. 예를 들어, Thread A가 Product 락을 획득한 후 User 락을 기다리고, Thread B가 User 락을 획득한 후 Product 락을 기다리면 Deadlock이 발생합니다. 이러한 문제를 방지하기 위해 다른 로직과 순서를 지켜 락을 사용하였습니다.

#### 재고 원복

```java
// ProductEventHandler.java
@Transactional
public void handleOrderCanceled(OrderEvent.OrderCanceled event) {
    if (event.orderItems() == null || event.orderItems().isEmpty()) {
        log.debug("주문 아이템이 없어 재고 원복을 건너뜁니다. (orderId: {})", event.orderId());
        return;
    }

    try {
        // ✅ Deadlock 방지: 상품 ID를 정렬하여 일관된 락 획득 순서 보장
        List<Long> sortedProductIds = event.orderItems().stream()
                .map(OrderEvent.OrderCanceled.OrderItemInfo::productId)
                .distinct()
                .sorted()
                .toList();

        // 정렬된 순서대로 상품 락 획득 (Deadlock 방지)
        Map<Long, Product> productMap = new HashMap<>();
        for (Long productId : sortedProductIds) {
            Product product = productService.getProductForUpdate(productId);
            productMap.put(productId, product);
        }

        // 재고 원복
        for (OrderEvent.OrderCanceled.OrderItemInfo itemInfo : event.orderItems()) {
            Product product = productMap.get(itemInfo.productId());
            if (product == null) {
                log.warn("상품을 찾을 수 없습니다. (orderId: {}, productId: {})",
                        event.orderId(), itemInfo.productId());
                continue;
            }
            product.increaseStock(itemInfo.quantity());
        }

        // 저장
        productService.saveAll(productMap.values().stream().toList());

        log.info("주문 취소로 인한 재고 원복 완료. (orderId: {})", event.orderId());
    } catch (Exception e) {
        log.error("주문 취소 이벤트 처리 중 오류 발생. (orderId: {})", event.orderId(), e);
        throw e;
    }
}
```

#### 포인트 환불
포인트도 동일한 기준으로 구성하였습니다.
```java
// PointEventHandler.java
@Transactional
public void handleOrderCanceled(OrderEvent.OrderCanceled event) {
    // ✅ 멱등성 보장: 환불할 포인트 금액이 없는 경우 처리하지 않음
    if (event.refundPointAmount() == null || event.refundPointAmount() == 0) {
        log.debug("환불할 포인트 금액이 없어 포인트 환불 처리를 건너뜁니다. (orderId: {})", event.orderId());
        return;
    }

    try {
        // ✅ Deadlock 방지: User 락을 먼저 획득하여 createOrder와 동일한 락 획득 순서 보장
        User user = userService.getUserById(event.userId());
        if (user == null) {
            log.warn("주문 취소 이벤트 처리 시 사용자를 찾을 수 없습니다. (orderId: {}, userId: {})",
                    event.orderId(), event.userId());
            return;
        }

        // 비관적 락을 사용하여 사용자 조회 (포인트 환불 시 동시성 제어)
        User lockedUser = userService.getUserForUpdate(user.getUserId());

        // 포인트 환불
        lockedUser.receivePoint(Point.of(event.refundPointAmount()));
        userService.save(lockedUser);

        log.info("주문 취소로 인한 포인트 환불 완료. (orderId: {}, userId: {}, refundPointAmount: {})",
                event.orderId(), event.userId(), event.refundPointAmount());
    } catch (Exception e) {
        log.error("포인트 환불 처리 중 오류 발생. (orderId: {}, userId: {}, refundPointAmount: {})",
                event.orderId(), event.userId(), event.refundPointAmount(), e);
        throw e;
    }
}
```

#### 4) 멱등성 보장

보상 트랜잭션의 멱등성을 보장하기 위해 다음과 같은 체크를 수행합니다:

- **OrderEventHandler**: 이미 취소된 주문인 경우 처리하지 않음
- **ProductEventHandler**: 주문 아이템이 없는 경우 처리하지 않음
- **PointEventHandler**: 환불할 포인트 금액이 0인 경우 처리하지 않음

#### 5) Deadlock 방지

동시성 제어를 위해 일관된 락 획득 순서를 보장합니다:

- **재고 원복**: 상품 ID를 정렬하여 일관된 락 획득 순서 보장
- **포인트 환불**: User 락을 먼저 획득하여 `createOrder`와 동일한 락 획득 순서 보장

---
### 4. 리팩토링: Application 레이어 책임 분리 및 DIP 준수
application 레이어에 로직들이 집중되어 구매를 처리하는 `PurchasingFacade`가 너무 많은 책임을 가지며 로직들을 이해하기 난해하게 구성된 문제가 있었습니다. 도메인 레이어로 책임들을 분리하고, 단일 도메인의 어플리케이션 로직을 처리하는 어플리케이션 서비스로 분리했으며 파사드는 각 도메인별 어플리케이션 서비스를 조합하는 역할만 하도록 재구성했습니다. 이를 통해 코드의 응집도를 높이고 결합도를 낮출 수 있습니다.

---

#### 1) 도메인의 분리

지난주차에 제가 결제 관련 비즈니스 규칙을 표현하며 관련 책임을 담당하는 도메인을 적절하게 분리하지 않은 점을 확인하여 payment 도메인을 새로 작성하였습니다.

#### (1) payment 도메인 분리

결제 관련 비즈니스 규칙과 로직이 `PurchasingFacade`에 분산되어 있어 결제 도메인의 책임이 명확하지 않았습니다. payment 도메인을 새로 분리하여 결제 관련 비즈니스 규칙과 로직을 한 곳에 모았습니다.

#### Before: 결제 로직이 PurchasingFacade에 분산

```java
// application/purchasing/PurchasingFacade.java
@Component
public class PurchasingFacade {
    private final PaymentGatewayAdapter paymentGatewayAdapter;  // ❌ Infra 직접 의존

    public OrderInfo createOrder(...) {
        // 결제 생성, PG 요청, 실패 분류, 타임아웃 복구 등 모든 로직이 Facade에 분산
        Payment payment = new Payment(...);
        PaymentResult result = paymentGatewayAdapter.requestPayment(...);
        if (isBusinessFailure(result.errorCode())) { ... }
    }

    private boolean isBusinessFailure(String errorCode) { ... }  // 비즈니스 규칙이 Facade에
}
```

**문제점:**
- 결제 관련 비즈니스 규칙이 `PurchasingFacade`에 분산되어 있음
- 결제 도메인의 책임이 명확하지 않음
- 결제 로직 재사용이 어려움
- 결제 관련 테스트가 복잡함 (Facade 전체를 테스트해야 함)
- 인프라 의존성(`PaymentGatewayAdapter`)이 Application 레이어에 직접 노출됨

#### After: payment 도메인으로 분리

```java
// domain/payment/Payment.java - 결제 비즈니스 규칙 캡슐화
@Entity
public class Payment {
    public static Payment create(...) {
        // 결제 생성 비즈니스 규칙
        Long paidAmount = totalAmount - usedPoint;
        PaymentStatus status = (paidAmount == 0) ? PaymentStatus.PAID : PaymentStatus.PENDING;
        return new Payment(...);
    }

    public void complete(String transactionKey) { ... }
    public void fail(String errorCode, String message) { ... }
}

// domain/payment/PaymentService.java - 결제 도메인 서비스
@Service
public class PaymentService {
    private final PaymentGateway paymentGateway;  // ✅ 도메인 인터페이스에 의존

    public PaymentRequestResult requestPayment(PaymentRequestCommand command) {
        Payment payment = Payment.create(...);
        PaymentRequestResult result = paymentGateway.requestPayment(command);
        // 결제 처리 로직...
        return result;
    }
}

// application/purchasing/PurchasingFacade.java
@Component
public class PurchasingFacade {
    private final PaymentService paymentService;  // ✅ payment 도메인 서비스에만 의존

    public OrderInfo createOrder(...) {
        PaymentRequestResult result = paymentService.requestPayment(...);
        return OrderInfo.from(order);
    }
}
```

**개선 효과:**
- 결제 관련 비즈니스 규칙이 payment 도메인에 집중되어 응집도 향상
- 결제 도메인의 책임이 명확해짐 (결제 생성, 상태 관리, 실패 처리 등)
- 결제 로직 재사용 가능: 다른 Facade에서도 `PaymentService` 사용 가능
- 테스트 용이성 향상: payment 도메인만 독립적으로 테스트 가능
- DIP 준수: `PaymentGateway` 인터페이스를 도메인 레이어에 정의하여 인프라 의존성 제거

---

#### (2) 도메인 캡슐화 개선

도메인 캡슐화하지 않고 getter 메소드로 처리한 부분을 수정했습니다.  도메인 엔티티의 상태를 직접 비교하거나 Value Object를 직접 노출하면, 도메인 로직이 외부로 분산되어 응집도가 낮아집니다. 도메인 메소드로 의미를 명확히 표현하면 코드 가독성이 향상되고, 상태 비교 로직 변경 시 한 곳만 수정하면 됩니다.

#### Before: 상태를 직접 비교하는 코드

```java
// PurchasingFacade.java
if (order.getStatus() == OrderStatus.COMPLETED || order.getStatus() == OrderStatus.CANCELED) {
    log.info("이미 완료되거나 취소된 주문입니다.");
    return true;
}
```

#### After: 도메인 메소드로 의미를 명확히 표현

```java
// PurchasingFacade.java
if (order.isCompleted() || order.isCanceled()) {
    log.debug("이미 완료된 주문입니다. 상태 업데이트를 건너뜁니다. (orderId: {})", orderId);
    return true;
}

// Order.java (도메인 엔티티)
public boolean isCompleted() {
    return this.status == OrderStatus.COMPLETED;
}

public boolean isCanceled() {
    return this.status == OrderStatus.CANCELED;
}
```

**개선 효과:**
- 도메인 로직이 엔티티 내부에 캡슐화되어 응집도 향상
- 코드 가독성 향상 및 의도 명확화
- 상태 비교 로직 변경 시 한 곳만 수정하면 됨

---

#### Before: Value Object를 직접 노출

```java
// UserService.java
public static PointsInfo from(User user) {
    return new PointsInfo(user.getUserId(), user.getPoint().getValue());
}
```

#### After: 도메인 메소드로 캡슐화

```java
// UserService.java
public static PointsInfo from(User user) {
    return new PointsInfo(user.getUserId(), user.getPointValue());
}

// User.java (도메인 엔티티)
public Long getPointValue() {
    return this.point.getValue();
}
```

**개선 효과:**
- Value Object의 내부 구조를 외부에 노출하지 않음
- 도메인 모델의 캡슐화 강화

---

#### (3) PaymentFailureClassifier를 도메인으로 이동

결제 실패 분류는 결제 도메인의 비즈니스 규칙입니다. 비즈니스 규칙은 도메인 계층에 위치해야 하며, 이를 enum의 정적 메소드로 표현하면 재사용성과 테스트 용이성이 향상됩니다.

#### Before: Application 레이어의 도메인 서비스

```java
// application/payment/PaymentFailureClassifier.java
@Component
public class PaymentFailureClassifier {
    public PaymentFailureType classify(String errorCode) {
        // 비즈니스 규칙이 Application 레이어에 위치
        return BUSINESS_FAILURE_CODES.stream().anyMatch(errorCode::contains)
            ? BUSINESS_FAILURE : EXTERNAL_SYSTEM_FAILURE;
    }
}

PaymentFailureType type = paymentFailureClassifier.classify(errorCode);
```

#### After: 도메인 enum의 정적 메소드로 이동

```java
// domain/payment/PaymentFailureType.java
public enum PaymentFailureType {
    BUSINESS_FAILURE, EXTERNAL_SYSTEM_FAILURE;

    public static PaymentFailureType classify(String errorCode) {
        // ✅ 비즈니스 규칙이 도메인 계층에 위치
        return BUSINESS_FAILURE_CODES.stream().anyMatch(errorCode::contains)
            ? BUSINESS_FAILURE : EXTERNAL_SYSTEM_FAILURE;
    }
}

PaymentFailureType type = PaymentFailureType.classify(errorCode);
```

**개선 효과:**
- 비즈니스 규칙이 도메인 계층에 위치하여 명확한 책임 분리
- 다른 애플리케이션 서비스에서 재사용 가능
- 테스트 용이성 향상 (정적 메소드로 단위 테스트 간소화)

---

#### 2) Application 서비스와 Facade의 분리

지난주차까지 '도메인 서비스는 상태(repository)를 갖지 않는다', '파사드는 도메인 서비스를 조합하는 어플리케이션 서비스다'라는 두 기준으로만 구성하여 모든 어플리케이션 서비스를 facade로 작성하였습니다. 각 도메인 단독으로 표현할 수 있는 부분도 유즈케이스별로 별도의 폴더가 생기다 보니 불필요하게 복잡해지고, 재사용할 수 있는 도메인의 규칙과 책임을 생각하지 않게 되었습니다.

#### (1) 문제 상황

예를 들어 `signup`, `userinfo`로 구성하다보니 다음과 같은 문제가 발생했습니다:

#### Before: 유즈케이스별 폴더 구조로 인한 복잡성

```
application/
├── signup/
│   └── SignUpService.java      # 회원가입 로직
└── userinfo/
    └── UserInfoService.java    # 사용자 정보 조회 로직
```

**문제점:**
- 같은 도메인(User)의 로직이 여러 서비스로 분산됨
- 재사용 가능한 도메인 규칙을 생각하지 않게 됨
- 유즈케이스가 늘어날수록 폴더와 서비스가 계속 증가

#### 2.2 개선: 도메인별 Application 서비스로 통합

#### After: 도메인별 Application 서비스 구조

```
application/
└── user/
    └── UserService.java         # User 도메인의 모든 어플리케이션 로직 통합
```

**개선 효과:**
- 단일 도메인의 어플리케이션 로직이 한 곳에 모여 응집도 향상
- 도메인의 규칙과 책임을 명확히 파악 가능
- 재사용 가능한 로직을 쉽게 식별 가능

#### (3) Facade는 여러 도메인 조합만 담당

여러 도메인의 어플리케이션 서비스를 조합해서 표현해야하는 경우만, 도메인과는 다른 이름 예를 들어 `purchasing`, `heart`와 같은 이름으로 별도의 패키지를 만들어 facade로 분리했습니다.

#### Before: 모든 로직이 Facade에 집중

```java
// PurchasingFacade.java
@Component
public class PurchasingFacade {
    private final UserRepository userRepository;           // ❌ Repository 직접 의존
    private final PaymentGatewayAdapter paymentGatewayAdapter;  // ❌ Infra 직접 의존

    public OrderInfo createOrder(...) {
        User user = userRepository.findByUserId(userId);
        Order order = new Order(...);
        orderRepository.save(order);
        PaymentResult result = paymentGatewayAdapter.requestPayment(...);
        // 수백 줄의 복잡한 로직...
    }
}
```

#### After: 도메인별 Application 서비스로 분리 후 Facade에서 조합

```java
// application/user/UserService.java
@Service
public class UserService {
    public User getUser(String userId) { ... }
}

// application/order/OrderService.java
@Service
public class OrderService {
    public Order createOrder(...) { ... }
}

// application/purchasing/PurchasingFacade.java
@Component
public class PurchasingFacade {
    private final UserService userService;           // ✅ 도메인별 Application 서비스
    private final OrderService orderService;
    private final PaymentService paymentService;

    public OrderInfo createOrder(...) {
        User user = userService.getUser(userId);
        Order order = orderService.createOrder(...);
        PaymentRequestResult result = paymentService.requestPayment(...);
        return OrderInfo.from(order);
    }
}
```

**개선 효과:**
- 각 도메인의 어플리케이션 로직이 명확히 분리됨
- Facade는 도메인 서비스 조합만 담당하여 단순해짐
- 각 도메인 서비스는 독립적으로 테스트 가능
- 재사용성 향상: 다른 Facade에서도 동일한 도메인 서비스 사용 가능

---

#### 3) DIP 원칙 준수
Application 레이어가 Infrastructure를 직접 의존하면, 도메인이 인프라 기술에 종속되어 테스트가 어려워지고 유연성이 떨어집니다. DIP를 적용하면 도메인이 필요로 하는 추상화를 도메인 레이어에 정의하고, Infrastructure가 이를 구현하므로 의존성 방향이 역전됩니다. 이 문제를 해결하고자 DIP를 준수하는 방향으로 개선했습니다.

#### (1) PG 처리 시 Application이 Infra를 의존하는 문제 해결

#### Before: Application 레이어가 Infrastructure 직접 의존

```java
// application/purchasing/PurchasingFacade.java
@Component
public class PurchasingFacade {
    private final PaymentGatewayAdapter paymentGatewayAdapter;  // ❌ Infra 직접 의존

    public void requestPayment(...) {
        PaymentResult result = paymentGatewayAdapter.requestPayment(...);
    }
}
```

#### After: 도메인 인터페이스를 통한 의존성 역전

```java
// domain/payment/PaymentGateway.java (도메인 인터페이스)
public interface PaymentGateway {
    PaymentRequestResult requestPayment(PaymentRequestCommand command);
}

// domain/payment/PaymentService.java
@Service
public class PaymentService {
    private final PaymentGateway paymentGateway;  // ✅ 도메인 인터페이스에 의존
}

// infrastructure/payment/PaymentGatewayAdapter.java
@Component
public class PaymentGatewayAdapter implements PaymentGateway {
    // 실제 PG API 호출 구현
}

// application/purchasing/PurchasingFacade.java
@Component
public class PurchasingFacade {
    private final PaymentService paymentService;  // ✅ 도메인 서비스에만 의존
}
```

**개선 효과:**
- DIP 원칙 준수: Application 레이어가 Infrastructure에 직접 의존하지 않음
- 도메인 독립성 확보: Payment 도메인이 필요로 하는 추상화를 도메인 레이어에 정의
- 테스트 용이성 향상: PaymentGateway 인터페이스를 Mock하여 테스트 가능

---

#### (2) 캐시 처리 시 DIP 위반 해결

#### Before: Application 레이어가 RedisTemplate 직접 의존

```java
// application/product/ProductCacheService.java
@Service
public class ProductCacheService {
    private final RedisTemplate<String, String> redisTemplate;  // ❌ Infra 직접 의존

    public ProductInfoList getCachedProductList(...) {
        String cachedValue = redisTemplate.opsForValue().get(cacheKey);
    }
}
```

#### After: 캐시 추상화를 통한 의존성 역전

```java
// modules/redis/CacheTemplate.java (인터페이스)
public interface CacheTemplate {
    <T> Optional<T> get(CacheKey<T> cacheKey);
    <T> void put(CacheKey<T> cacheKey, T value);
}

// modules/redis/RedisCacheTemplate.java (구현체)
@Component
public class RedisCacheTemplate implements CacheTemplate {
    // Redis 구현
}

// application/product/ProductCacheService.java
@Service
public class ProductCacheService {
    private final CacheTemplate cacheTemplate;  // ✅ 인터페이스에 의존
}
```

**개선 효과:**
- DIP 준수: Application 레이어가 캐시 인터페이스에만 의존
- 테스트 용이성 향상: CacheTemplate 인터페이스를 Mock하여 테스트 가능
- 유연성 향상: Redis에서 다른 캐시로 변경 시 구현체만 교체하면 됨

**참고:** `CACHE_USAGE_COMPARISON_DDD_EVALUATION.md` 문서를 참고하여 다른 프로젝트들의 캐시 사용 방식을 분석하고 개선했습니다.

---

#### (3) Scheduler를 Infrastructure 레이어로 이동

Scheduler는 도메인 규칙을 표현하는 것이 아니라 단순히 기술적인 설정이므로 Infrastructure 레이어에 배치하는 것이 적절합니다. 도메인 로직은 도메인 서비스에 위임하여 단일 책임 원칙을 준수합니다.

#### Before: Application 레이어에 Scheduler

```java
// application/payment/PaymentScheduler.java
@Component
public class PaymentScheduler {
    @Scheduled(fixedDelay = 5000)
    public void checkPaymentStatus() { ... }
}
```

#### After: Infrastructure 레이어로 이동

```java
// infrastructure/payment/PaymentStatusScheduler.java
@Component
public class PaymentStatusScheduler {
    private final PaymentService paymentService;  // 도메인 서비스에 의존
    @Scheduled(fixedDelay = 5000)
    public void checkPaymentStatus() { ... }
}
```

**개선 효과:**
- 기술적 관심사(scheduling)가 Infrastructure 레이어에 위치하여 레이어 책임이 명확해짐
- 도메인 로직은 도메인 서비스에 위임하여 단일 책임 원칙 준수


-->

## ✅ Checklist
- [x] **주문 ↔ 결제 이벤트 기반 분리**
  - [x] 주문 생성과 쿠폰 사용 처리를 이벤트로 분리
    - 파일: `apps/commerce-api/src/main/java/com/loopers/application/coupon/CouponEventHandler.java`
    - 파일: `apps/commerce-api/src/main/java/com/loopers/domain/order/OrderEvent.java`
  - [x] 결제 결과에 따른 주문 처리를 이벤트로 분리
    - 파일: `apps/commerce-api/src/main/java/com/loopers/application/order/OrderEventHandler.java`
    - 파일: `apps/commerce-api/src/main/java/com/loopers/domain/payment/PaymentEvent.java`
  - [x] 주문/결제 결과에 대한 데이터 플랫폼 전송 후속처리
    - 파일: `apps/commerce-api/src/main/java/com/loopers/interfaces/event/data/DataEventListener.java`

- [x] **좋아요 ↔ 집계 이벤트 기반 분리**
  - [x] 좋아요 처리와 집계를 이벤트로 분리
    - 파일: `apps/commerce-api/src/main/java/com/loopers/application/product/ProductEventHandler.java`
    - 파일: `apps/commerce-api/src/main/java/com/loopers/domain/like/LikeEvent.java`
  - [x] 집계 로직의 성공/실패와 무관하게 좋아요 처리는 정상 완료
    - 파일: `apps/commerce-api/src/main/java/com/loopers/interfaces/event/product/ProductEventListener.java` (예외 처리 확인)

- [x] **공통 요건**
  - [x] 이벤트 기반으로 유저 행동에 대한 서버 레벨 로깅 및 추적
    - 파일: `apps/commerce-api/src/main/java/com/loopers/interfaces/event/data/DataEventListener.java`
  - [x] 동작의 주체를 적절하게 분리하고 트랜잭션 간 연관관계 고민
    - Event Handler: `apps/commerce-api/src/main/java/com/loopers/application/*/EventHandler.java`
    - Event Listener: `apps/commerce-api/src/main/java/com/loopers/interfaces/event/*/EventListener.java`

## 📎 References
- Source: https://github.com/Loopers-dev-lab/loopers-spring-java-template/pull/171
