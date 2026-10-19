# Example Final Output

Synthesized from 3 chunks: (A) Order API + domain, (B) Payment integration, (C) Inventory + messaging.

This example shows the complete report-only output in its final form: the HTML body the model writes into `{{REVIEW_BODY_HTML}}`, and the table-of-contents items it writes into `{{TOC_ITEMS_HTML}}`. It holds the Walkthrough, then verdict-labeled findings split into Correctness, Requirement Gap, and Cleanup. There is no merge verdict — the review reports, it does not gate.

Things to copy from it:

- Every heading has a unique `id` (`[a-z0-9-]`), and the TOC items link to those ids with `href="#id"`.
- Every piece of code, identifier, path, and quoted text is HTML-escaped (`&lt;`, `&gt;`, `&amp;`). Look at `ResponseEntity&lt;PaymentResponse&gt;` and `-&gt;` in the code blocks.
- The findings keep the agent's wording and verdicts. Only the markup changed from the agent's markdown cards to the card HTML shown here.
- No `<script>`, no event attributes, no `href` other than the in-page TOC anchors.

## `{{TOC_ITEMS_HTML}}`

```html
<li class="lvl-2"><a href="#walkthrough">Walkthrough</a></li>
<li class="lvl-3"><a href="#change-summary">Change Summary</a></li>
<li class="lvl-3"><a href="#core-logic-analysis">Core Logic Analysis</a></li>
<li class="lvl-3"><a href="#architecture-diagram">Architecture Diagram</a></li>
<li class="lvl-3"><a href="#sequence-diagram">Sequence Diagram</a></li>
<li class="lvl-2"><a href="#findings">Findings</a></li>
<li class="lvl-3"><a href="#correctness">Correctness</a></li>
<li class="lvl-3"><a href="#requirement-gap">Requirement Gap</a></li>
<li class="lvl-3"><a href="#cleanup">Cleanup</a></li>
<li class="lvl-2"><a href="#out-of-scope">Out of Scope (Pre-existing)</a></li>
<li class="lvl-2"><a href="#recommendations">Recommendations</a></li>
```

## `{{REVIEW_BODY_HTML}}`

````html
<h2 id="walkthrough">Walkthrough</h2>

<h3 id="change-summary">Change Summary</h3>
<p>Implements end-to-end order payment flow for the e-commerce platform, spanning three domains: order lifecycle management (creation, validation, state transitions), payment gateway integration (Stripe charge creation, webhook handling), and inventory reservation (stock deduction on payment confirmation with Kafka-based async messaging). The PR introduces 9 new files and modifies 3 existing files across the API, domain, infrastructure, and messaging layers. Orders transition through a state machine (<code>CREATED</code> → <code>PENDING_PAYMENT</code> → <code>PAYMENT_IN_PROGRESS</code> → <code>PAID</code> → <code>FULFILLMENT_READY</code>), with inventory reserved asynchronously on payment confirmation via a Kafka event. A Flyway migration adds the <code>payment_records</code> and <code>inventory_reservations</code> tables to support the new flows.</p>

<h3 id="core-logic-analysis">Core Logic Analysis</h3>
<p><b>Order Lifecycle (<code>order/</code>)</b>:<br>
<code>OrderController.kt</code> exposes <code>POST /api/v1/orders</code> for creation and <code>POST /api/v1/orders/{id}/pay</code> to initiate payment. <code>OrderService.kt</code> owns the order state machine — <code>canTransition()</code> validates allowed state changes, <code>initiatePayment()</code> transitions from <code>CREATED</code>/<code>PENDING_PAYMENT</code> to <code>PAYMENT_IN_PROGRESS</code> and delegates to the payment layer. <code>OrderRepository.kt</code> adds <code>findByIdWithLock()</code> using <code>@Lock(PESSIMISTIC_WRITE)</code> to prevent concurrent payment attempts on the same order. The state machine is enforced at the service layer, not via DB constraints.</p>
<p><b>Payment Integration (<code>payment/</code>)</b>:<br>
<code>OrderPaymentController.kt</code> orchestrates the payment flow: validates order state, delegates to <code>StripeGatewayAdapter.charge()</code>, and persists the <code>PaymentRecord</code>. <code>StripeGatewayAdapter.kt</code> implements the <code>PaymentGateway</code> port — maps domain <code>PaymentCommand</code> to Stripe params, calls the SDK, maps the response back. The webhook endpoint receives async confirmations and publishes a <code>PaymentConfirmedEvent</code> to Kafka.</p>
<p><b>Inventory Reservation (<code>inventory/</code>)</b>:<br>
<code>InventoryService.kt</code> listens for <code>PaymentConfirmedEvent</code> via <code>@KafkaListener</code> and reserves stock by decrementing <code>available_quantity</code> with <code>SELECT ... FOR UPDATE</code> to prevent overselling. On insufficient stock it publishes an <code>InventoryShortageEvent</code>. The <code>InventoryReservation</code> entity tracks which order reserved which SKUs for idempotency on retry.</p>
<p><b>Messaging (<code>kafka/</code>)</b>:<br>
<code>PaymentEventProducer.kt</code> publishes to <code>payment-events</code> keyed by <code>orderId</code> for partition affinity — events for the same order keep ordering. No dead-letter topic is configured for the consumer group.</p>

<h3 id="architecture-diagram">Architecture Diagram</h3>
<figure>
<div class="fig-scroll" tabindex="0" role="region" aria-label="Figure 1 architecture, scrolls sideways on a phone">
<svg viewBox="0 0 728 312" style="min-width:728px" role="img" aria-label="Order payment architecture: OrderController delegates to OrderService, which pays through the PaymentGateway interface. The new StripeGatewayAdapter implements that interface. The new OrderPaymentController charges through the adapter and publishes to the new PaymentEventProducer, which feeds InventoryService over Kafka.">
<defs><marker id="f1-ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" class="mk-mut"/></marker></defs>
<!-- columns x=16, 272, 528 (w=184); rows y=24, 136, 248 (h=48) -->
<path class="rel" d="M200 48 H272" marker-end="url(#f1-ah)"/><text class="t-s halo" x="236" y="38" text-anchor="middle">delegates</text>
<path class="rel" d="M456 48 H528" marker-end="url(#f1-ah)"/><text class="t-s halo" x="492" y="38" text-anchor="middle">payment</text>
<path class="rel ret" d="M620 136 V72" marker-end="url(#f1-ah)"/><text class="t-s halo" x="632" y="108">implements</text>
<path class="rel" d="M200 160 H528" marker-end="url(#f1-ah)"/><text class="t-s halo" x="364" y="150" text-anchor="middle">charge</text>
<path class="rel" d="M108 184 V248" marker-end="url(#f1-ah)"/><text class="t-s halo" x="120" y="220">publish</text>
<path class="rel" d="M200 272 H528" marker-end="url(#f1-ah)"/><text class="t-s halo" x="364" y="262" text-anchor="middle">Kafka payment-events</text>
<rect class="box" x="16" y="24" width="184" height="48" rx="8"/><text class="t-b" x="108" y="46" text-anchor="middle">OrderController</text>
<rect class="box mod" x="272" y="24" width="184" height="48" rx="8"/><text class="t-b" x="364" y="46" text-anchor="middle">OrderService</text><text class="t-s" x="364" y="64" text-anchor="middle">MODIFIED</text>
<rect class="box" x="528" y="24" width="184" height="48" rx="8"/><text class="t-b" x="620" y="46" text-anchor="middle">PaymentGateway</text><text class="t-s" x="620" y="64" text-anchor="middle">interface</text>
<rect class="box new" x="16" y="136" width="184" height="48" rx="8"/><text class="t-b" x="108" y="158" text-anchor="middle">OrderPaymentController</text><text class="t-s" x="108" y="176" text-anchor="middle">NEW</text>
<rect class="box new" x="528" y="136" width="184" height="48" rx="8"/><text class="t-b" x="620" y="158" text-anchor="middle">StripeGatewayAdapter</text><text class="t-s" x="620" y="176" text-anchor="middle">NEW</text>
<rect class="box new" x="16" y="248" width="184" height="48" rx="8"/><text class="t-b" x="108" y="270" text-anchor="middle">PaymentEventProducer</text><text class="t-s" x="108" y="288" text-anchor="middle">NEW</text>
<rect class="box" x="528" y="248" width="184" height="48" rx="8"/><text class="t-b" x="620" y="270" text-anchor="middle">InventoryService</text>
</svg>
</div>
<p class="fig-hint">The figure scrolls sideways. Every edge is also in the table below.</p>
<div class="edge-table"><table><thead><tr><th>From</th><th>Label</th><th>To</th></tr></thead><tbody><tr><td>OrderController</td><td>delegates</td><td>OrderService</td></tr><tr><td>OrderService</td><td>payment</td><td>PaymentGateway</td></tr><tr><td>StripeGatewayAdapter</td><td>implements</td><td>PaymentGateway</td></tr><tr><td>OrderPaymentController</td><td>charge</td><td>StripeGatewayAdapter</td></tr><tr><td>OrderPaymentController</td><td>publish</td><td>PaymentEventProducer</td></tr><tr><td>PaymentEventProducer</td><td>Kafka payment-events</td><td>InventoryService</td></tr></tbody></table></div>
<figcaption><b>Figure 1. Payment goes through a new gateway adapter, and the confirmation event reaches inventory over Kafka.</b> Green boxes are new, the amber box is modified, the dashed edge is an interface implementation.</figcaption>
</figure>

<h3 id="sequence-diagram">Sequence Diagram</h3>
<figure>
<div class="fig-scroll" tabindex="0" role="region" aria-label="Figure 2 sequence, scrolls sideways on a phone">
<svg viewBox="0 0 866 400" style="min-width:840px" role="img" aria-label="Payment sequence: a client posts the pay request to OrderController, which calls OrderPaymentController. That controller charges through StripeGatewayAdapter and gets a result back, then publishes an event to Kafka. Kafka delivers the event to InventoryService, which reserves stock.">
<defs><marker id="f2-ah" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0 0L8 3L0 6z" class="mk-mut"/></marker></defs>
<!-- lifelines x=164, 320, 476, 632, 788; message rows every 40px from y=100 -->
<line class="life" x1="164" y1="72" x2="164" y2="388"/><line class="life" x1="320" y1="72" x2="320" y2="388"/><line class="life" x1="476" y1="72" x2="476" y2="388"/><line class="life" x1="632" y1="72" x2="632" y2="388"/><line class="life" x1="788" y1="72" x2="788" y2="388"/>
<rect class="act" x="159" y="100" width="10" height="40"/><rect class="act" x="315" y="140" width="10" height="120"/><rect class="act" x="471" y="180" width="10" height="40"/><rect class="act" x="783" y="300" width="10" height="64"/>
<circle class="dot" cx="8" cy="100" r="3"/>
<path class="msg" d="M8 100 H159" marker-end="url(#f2-ah)"/><rect class="mask" x="9" y="76" width="150" height="18" rx="2"/><text class="m" x="84" y="90" text-anchor="middle">POST /orders/{id}/pay</text>
<path class="msg" d="M169 140 H315" marker-end="url(#f2-ah)"/><rect class="mask" x="183" y="116" width="118" height="18" rx="2"/><text class="m" x="242" y="130" text-anchor="middle">processPayment()</text>
<path class="msg" d="M325 180 H471" marker-end="url(#f2-ah)"/><rect class="mask" x="342" y="156" width="112" height="18" rx="2"/><text class="m" x="398" y="170" text-anchor="middle">charge(command)</text>
<path class="msg ret" d="M471 220 H325" marker-end="url(#f2-ah)"/><rect class="mask" x="349" y="196" width="98" height="18" rx="2"/><text class="m" x="398" y="210" text-anchor="middle">PaymentResult</text>
<path class="msg" d="M325 260 H632" marker-end="url(#f2-ah)"/><rect class="mask" x="506" y="236" width="98" height="18" rx="2"/><text class="m" x="555" y="250" text-anchor="middle">publish event</text>
<path class="msg" d="M632 300 H783" marker-end="url(#f2-ah)"/><rect class="mask" x="658" y="276" width="98" height="18" rx="2"/><text class="m" x="707" y="290" text-anchor="middle">consume event</text>
<path class="msg" d="M793 340 H814 Q822 340 822 348 V356 Q822 364 814 364 H793" marker-end="url(#f2-ah)"/><rect class="mask" x="670" y="320" width="104" height="18" rx="2"/><text class="m" x="772" y="334" text-anchor="end">reserveStock()</text>
<rect class="box" x="94" y="20" width="140" height="52" rx="6"/><text class="t-b" x="164" y="40" text-anchor="middle">Order</text><text class="t-b" x="164" y="58" text-anchor="middle">Controller</text><rect class="box" x="250" y="20" width="140" height="52" rx="6"/><text class="t-b" x="320" y="40" text-anchor="middle">OrderPayment</text><text class="t-b" x="320" y="58" text-anchor="middle">Controller</text><rect class="box" x="406" y="20" width="140" height="52" rx="6"/><text class="t-b" x="476" y="40" text-anchor="middle">StripeGateway</text><text class="t-b" x="476" y="58" text-anchor="middle">Adapter</text><rect class="box" x="562" y="20" width="140" height="52" rx="6"/><text class="t-b" x="632" y="40" text-anchor="middle">Kafka</text><text class="t-b" x="632" y="58" text-anchor="middle"></text><rect class="box" x="718" y="20" width="140" height="52" rx="6"/><text class="t-b" x="788" y="40" text-anchor="middle">Inventory</text><text class="t-b" x="788" y="58" text-anchor="middle">Service</text>
</svg>
</div>
<p class="fig-hint">The figure scrolls sideways. Every message is also in the table below.</p>
<div class="edge-table"><table><thead><tr><th>Order</th><th>From</th><th>To</th><th>Message</th></tr></thead><tbody><tr><td>1</td><td>Client</td><td>OrderController</td><td>POST /orders/{id}/pay</td></tr><tr><td>2</td><td>OrderController</td><td>OrderPaymentController</td><td>processPayment()</td></tr><tr><td>3</td><td>OrderPaymentController</td><td>StripeGatewayAdapter</td><td>charge(command)</td></tr><tr><td>4</td><td>StripeGatewayAdapter</td><td>OrderPaymentController</td><td>PaymentResult (return)</td></tr><tr><td>5</td><td>OrderPaymentController</td><td>Kafka</td><td>publish event</td></tr><tr><td>6</td><td>Kafka</td><td>InventoryService</td><td>consume event</td></tr><tr><td>7</td><td>InventoryService</td><td>InventoryService</td><td>reserveStock()</td></tr></tbody></table></div>
<figcaption><b>Figure 2. Confirmation flows from the charge result to a Kafka event and then to inventory reservation.</b> The event is <code>PaymentConfirmedEvent</code>; <code>reserveStock()</code> decrements stock under <code>SELECT ... FOR UPDATE</code>.</figcaption>
</figure>

<hr>

<h2 id="findings">Findings</h2>

<h3 id="correctness">Correctness</h3>
<div class="findings-grid">
<div class="finding" data-verdict="CONFIRMED">
<p><b>[CONFIRMED] <code>@Transactional</code> wraps the external HTTP call to Stripe</b><br><span class="loc"><code>OrderPaymentController.kt:34</code> — <code>processPayment()</code></span></p>
<ul>
<li><b>Current Code</b>: 
<pre><code class="language-kotlin">@PostMapping("/{orderId}/payment")
@Transactional
fun processPayment(@PathVariable orderId: Long, @RequestBody @Valid request: PaymentRequest): ResponseEntity&lt;PaymentResponse&gt; {
    val order = orderRepository.findByIdWithLock(orderId)
        ?: throw OrderNotFoundException(orderId)
    order.transitionTo(OrderStatus.PAYMENT_IN_PROGRESS)
    val result = stripeGatewayAdapter.charge(order, request)  // external HTTP call inside TX
    val record = paymentRecordRepository.save(PaymentRecord.from(order, result))
    order.transitionTo(OrderStatus.PAID)
    return ResponseEntity.ok(PaymentResponse.from(record))
}</code></pre></li>
<li><b>What's wrong</b>: <code>processPayment()</code> is <code>@Transactional</code>, but <code>stripeGatewayAdapter.charge()</code> is an external HTTP round-trip (500ms–2s). The DB connection is held open for the entire network call.</li>
<li><b>Failure scenario</b>: Under concurrent load, ~10 in-flight payments exhaust the HikariCP pool; every other DB operation (order lookup, cart) then blocks. Every payment request holds a DB connection across the Stripe call, so this manifests in normal operation, not only at peak.</li>
<li><b>Fix</b>: 
<pre><code class="language-diff">-@PostMapping("/{orderId}/payment")
-@Transactional
-fun processPayment(...): ResponseEntity&lt;PaymentResponse&gt; {
-    val order = orderRepository.findByIdWithLock(orderId) ?: throw OrderNotFoundException(orderId)
-    order.transitionTo(OrderStatus.PAYMENT_IN_PROGRESS)
-    val result = stripeGatewayAdapter.charge(order, request)
-    val record = paymentRecordRepository.save(PaymentRecord.from(order, result))
-    order.transitionTo(OrderStatus.PAID)
-    return ResponseEntity.ok(PaymentResponse.from(record))
-}
+@PostMapping("/{orderId}/payment")
+fun processPayment(...): ResponseEntity&lt;PaymentResponse&gt; {
+    val order = paymentApplicationService.initiatePayment(orderId)       // TX 1: validate + mark IN_PROGRESS
+    val result = stripeGatewayAdapter.charge(order, request)            // external call outside any TX
+    val record = paymentApplicationService.persistResult(order, result) // TX 2: save + update status
+    return ResponseEntity.ok(PaymentResponse.from(record))
+}</code></pre></li>
<li><b>Blast Radius</b>: <code>OrderController.kt:initiatePayment()</code> calls <code>processPayment()</code>; the new <code>PaymentApplicationService</code> becomes the transaction owner.</li>
<li><b>Found by</b>: correctness</li>
</ul>
</div>
<div class="finding" data-verdict="PLAUSIBLE">
<p><b>[PLAUSIBLE] Webhook marks order PAID without re-checking the charged amount</b><br><span class="loc"><code>OrderPaymentController.kt:88</code> — <code>handleWebhook()</code></span></p>
<ul>
<li><b>Current Code</b>: 
<pre><code class="language-kotlin">@PostMapping("/webhook")
fun handleWebhook(@RequestBody payload: String, @RequestHeader("Stripe-Signature") sig: String): ResponseEntity&lt;Unit&gt; {
    stripeGatewayAdapter.verifyWebhookSignature(payload, sig)
    val event = objectMapper.readValue(payload, StripeEvent::class.java)
    if (event.type == "payment_intent.succeeded") {
        val order = orderRepository.findByPaymentIntentId(event.data.id)
            ?: return ResponseEntity.ok().build()
        order.transitionTo(OrderStatus.PAID)   // no amount comparison
    }
    return ResponseEntity.ok().build()
}</code></pre></li>
<li><b>What's wrong</b>: The webhook transitions the order to PAID on <code>payment_intent.succeeded</code> but never compares the charged amount against the order total.</li>
<li><b>Failure scenario</b>: If a PaymentIntent's amount can be influenced below the order total (client-tampered create path, or a partial-capture flow), the order is set to PAID for less than owed. Whether the create path is influenceable is not provable from this diff — realistic but unconfirmed, hence PLAUSIBLE. Confirm by checking that <code>PaymentIntentCreateParams.amount</code> is server-derived only.</li>
<li><b>Fix</b>: In <code>handleWebhook()</code>, load the order and assert <code>event.amount == order.totalMinorUnits</code> before transitioning to PAID; reject and alert on mismatch.</li>
<li><b>Blast Radius</b>: webhook path only; <code>verifyWebhookSignature()</code> already runs first.</li>
<li><b>Found by</b>: regression</li>
</ul>
</div>
</div>

<h3 id="requirement-gap">Requirement Gap</h3>
<div class="findings-grid">
<div class="finding" data-verdict="CONFIRMED">
<p><b>[CONFIRMED] Refund path is specified but never implemented</b><br><span class="loc"><code>OrderPaymentController.kt</code> — no refund handler exists</span></p>
<ul>
<li><b>Current Code</b>: 
<pre><code class="language-kotlin">// OrderPaymentController exposes only:
//   POST /{orderId}/payment   -&gt; processPayment()
//   POST /webhook             -&gt; handleWebhook()
// No refund endpoint, and no call into stripeGatewayAdapter.refund().</code></pre></li>
<li><b>What's wrong</b>: The acceptance criterion requires a refund path for a failed fulfillment, but the diff adds neither an endpoint nor a gateway call for it. The payment side is complete; the reverse side is absent.</li>
<li><b>Failure scenario</b>: An operator handling a failed fulfillment has no way to return the charge — the order sits PAID with the money captured, and the reconciliation job flags it as a permanent mismatch.</li>
<li><b>Fix</b>: Add <code>POST /{orderId}/refund</code> calling <code>stripeGatewayAdapter.refund(paymentIntentId, amount)</code>, transitioning the order to REFUNDED inside the same transaction boundary as the status write.</li>
<li><b>Blast Radius</b>: new endpoint; touches <code>OrderStatus</code> transitions and the reconciliation job's expectations.</li>
<li><b>AC</b>: “A captured payment can be reversed when fulfillment fails, and the order reaches a terminal REFUNDED state.”</li>
<li><b>Found by</b>: requirement</li>
</ul>
</div>
</div>

<h3 id="cleanup">Cleanup</h3>
<div class="findings-grid">
<div class="finding" data-verdict="CONFIRMED">
<p><b>[CONFIRMED] <code>PaymentRecord.from()</code> re-implements the money-conversion helper</b><br><span class="loc"><code>PaymentRecord.kt:21</code></span></p>
<ul>
<li><b>Current Code</b>: 
<pre><code class="language-kotlin">fun from(order: Order, result: PaymentResult): PaymentRecord =
    PaymentRecord(
        orderId = order.id,
        amountMinor = result.amount.multiply(BigDecimal(100)).toLong(),  // re-implements MoneyUtils.toMinorUnits
        currency = order.currency,
    )</code></pre></li>
<li><b>What's wrong</b>: Converts to minor units inline (<code>amount.multiply(BigDecimal(100)).toLong()</code>) when <code>MoneyUtils.toMinorUnits(amount, currency)</code> already exists and handles rounding and zero-decimal currencies (JPY).</li>
<li><b>Failure scenario (cost)</b>: The duplicated money logic drifts from the canonical helper, and the inline version silently mishandles zero-decimal currencies — a correctness-and-maintenance liability the next currency addition will trip on.</li>
<li><b>Fix</b>: Replace the inline conversion with <code>MoneyUtils.toMinorUnits(amount, currency)</code>.</li>
<li><b>Blast Radius</b>: This location only.</li>
<li><b>Found by</b>: cleanup</li>
</ul>
</div>
</div>

<h2 id="out-of-scope">Out of Scope (Pre-existing)</h2>
<div class="findings-grid">
<div class="finding" data-verdict="PLAUSIBLE">
<p><b>[PLAUSIBLE] [Pre-existing] <code>inventory_reservations.order_id</code> is unindexed</b><br><span class="loc"><code>inventory_reservations</code> table (predates this PR)</span></p>
<p>The idempotency lookup added in this PR reads <code>inventory_reservations</code> by <code>order_id</code>, but the column has no index, so reads are full scans. Not introduced here, but this PR is the first heavy reader. Noted, not blocking.</p>
</div>
</div>

<h2 id="recommendations">Recommendations</h2>
<ul>
<li>Resolve the <code>@Transactional</code>-over-Stripe finding (<code>OrderPaymentController.kt:34</code>) — removes a bug that exhausts the connection pool under normal load.</li>
<li>Add the webhook amount re-check (<code>OrderPaymentController.kt:88</code>) — preserves the requirement that an order is never set to PAID for less than its total.</li>
<li>Replace the inline money conversion with <code>MoneyUtils.toMinorUnits</code> (<code>PaymentRecord.kt:21</code>) — improves maintainability and removes the latent zero-decimal-currency bug.</li>
</ul>
````
