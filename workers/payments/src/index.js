// Reset Traders payments (Cloudflare Worker "shiny-dew-032freset-traders-payments").
// Based on the live version bbaa4980 (June 2026). Changes from it:
//   - Sells "Your Personal Reset" founding seats in INR and USD. The first FOUNDING_SEATS paid seats get the
//     founding price, later ones the standard price. The server decides the price, never the browser.
//   - The old "The Trader Reset" and Elite plans are removed (Elite is apply-only and its price is private).
//   - A paid founding seat does NOT switch on the old course in the portal. It records users/{uid}.reset
//     (seat confirmed, opens OPENS_AT). Portal access for the new course is switched on when it opens.
//   - Admin-only test mode with Razorpay test keys, so a full purchase can be tested without real money.
//   - GET /founding returns seats left and prices for the website.
//   - CORS only for the website's own origins.

const FOUNDING_SEATS = 100;
const OPENS_AT = "2027-01-01";

const PLANS = {
  reset_in: { product: "reset", name: "Your Personal Reset", currency: "INR", founding: 1999900, standard: 2499900 },
  reset_intl: { product: "reset", name: "Your Personal Reset", currency: "USD", founding: 24700, standard: 29700 }
};

const SITE_ORIGINS = ["https://www.resettraders.com", "https://resettraders.com"];

const FIREBASE_ENV = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_WEB_API_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY"
];

const RAZORPAY_ENV = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET"
];

const TEST_ENV = [
  "RAZORPAY_TEST_KEY_ID",
  "RAZORPAY_TEST_KEY_SECRET"
];

let cachedGoogleToken = null;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env, request) });
    }

    try {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "reset-traders-payments" }, 200, env, request);
      }
      if (url.pathname === "/founding" && request.method === "GET") {
        return await handleFounding(request, env);
      }
      if (url.pathname === "/create-order" && request.method === "POST") {
        return await handleCreateOrder(request, env);
      }
      if (url.pathname === "/verify-payment" && request.method === "POST") {
        return await handleVerifyPayment(request, env);
      }
      if (url.pathname === "/razorpay-webhook" && request.method === "POST") {
        return await handleRazorpayWebhook(request, env);
      }
      if (url.pathname === "/payment-status" && request.method === "GET") {
        return await handlePaymentStatus(request, env);
      }
      return json({ error: "Not found" }, 404, env, request);
    } catch (error) {
      console.error(error);
      return json(
        { error: error.message || "Payment server error." },
        error.status || 500,
        env,
        request
      );
    }
  }
};

// ---------- founding seats ----------

async function foundingSold(env, token) {
  const doc = await firestoreGet(env, token, "site/founding");
  return Number(doc?.sold || 0);
}

function priceFor(plan, sold) {
  const founding = sold < FOUNDING_SEATS;
  return { amount: founding ? plan.founding : plan.standard, tier: founding ? "founding" : "standard" };
}

async function handleFounding(request, env) {
  assertEnv(env, FIREBASE_ENV);
  const token = await googleAccessToken(env);
  const sold = await foundingSold(env, token);
  return json({
    total: FOUNDING_SEATS,
    left: Math.max(0, FOUNDING_SEATS - sold),
    opensAt: OPENS_AT,
    prices: Object.fromEntries(Object.entries(PLANS).map(([id, p]) => [id, { currency: p.currency, ...priceFor(p, sold) }]))
  }, 200, env, request, { "Cache-Control": "public, max-age=60" });
}

// ---------- keys (live, or test for admins) ----------

function razorpayKeys(env, test) {
  return test
    ? { id: env.RAZORPAY_TEST_KEY_ID, secret: env.RAZORPAY_TEST_KEY_SECRET }
    : { id: env.RAZORPAY_KEY_ID, secret: env.RAZORPAY_KEY_SECRET };
}

// ---------- create order ----------

async function handleCreateOrder(request, env) {
  assertEnv(env, [...FIREBASE_ENV, ...RAZORPAY_ENV]);
  const buyer = await verifyFirebaseBearer(request, env);
  const body = await readJson(request);
  const planId = String(body.plan || "");
  const plan = PLANS[planId];
  if (!plan) return json({ error: "Invalid plan." }, 400, env, request);

  const email = normalizeEmail(body.email);
  if (!email || email !== normalizeEmail(buyer.email)) {
    return json({ error: "Checkout email must match the signed-in account." }, 403, env, request);
  }

  const name = String(body.name || buyer.displayName || "").trim().slice(0, 120);
  const phone = String(body.phone || "").replace(/[^\d+]/g, "").slice(0, 16);
  if (!name || phone.replace(/\D/g, "").length < 7) {
    return json({ error: "Name and phone are required." }, 400, env, request);
  }

  const token = await googleAccessToken(env);

  // Test mode: only for admin accounts, and only when test keys are configured.
  const test = body.test === true;
  if (test) {
    assertEnv(env, TEST_ENV);
    const profile = await firestoreGet(env, token, `users/${buyer.localId}`);
    if (profile?.role !== "admin") return json({ error: "Test mode is for admin accounts only." }, 403, env, request);
  }

  const existing = await firestoreGet(env, token, `users/${buyer.localId}`);
  if (!test && existing?.reset?.status && existing.reset.status !== "test") {
    return json({ error: "This account already has a seat. Log in to the student portal." }, 409, env, request);
  }

  const sold = await foundingSold(env, token);
  const { amount, tier } = priceFor(plan, sold);
  const keys = razorpayKeys(env, test);

  const receipt = `rt_${Date.now().toString(36)}_${buyer.localId.slice(0, 6)}`;
  const razorpayOrder = await razorpayRequest(keys, "/v1/orders", {
    method: "POST",
    body: {
      amount,
      currency: plan.currency,
      receipt,
      notes: { uid: buyer.localId, email, name, phone, plan: planId, tier, test: test ? "yes" : "no" }
    }
  });

  await firestorePatch(env, token, `orders/${razorpayOrder.id}`, {
    uid: buyer.localId,
    email,
    name,
    phone,
    plan: planId,
    product: plan.product,
    tier,
    test,
    amount,
    currency: plan.currency,
    status: "created",
    receipt,
    razorpayOrderId: razorpayOrder.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  return json({
    orderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: keys.id,
    tier,
    test
  }, 200, env, request);
}

// ---------- verify (checkout handler) ----------

async function handleVerifyPayment(request, env) {
  assertEnv(env, [...FIREBASE_ENV, ...RAZORPAY_ENV]);
  const buyer = await verifyFirebaseBearer(request, env);
  const body = await readJson(request);
  const orderId = String(body.razorpay_order_id || body.orderId || "");
  const paymentId = String(body.razorpay_payment_id || body.paymentId || "");
  const signature = String(body.razorpay_signature || body.signature || "");

  if (!orderId || !paymentId || !signature) {
    return json({ error: "Missing Razorpay payment verification fields." }, 400, env, request);
  }

  const token = await googleAccessToken(env);
  const order = await firestoreGet(env, token, `orders/${orderId}`);
  if (!order || order.uid !== buyer.localId) {
    return json({ error: "Order not found for this account." }, 404, env, request);
  }

  const keys = razorpayKeys(env, order.test === true);
  const signatureOk = await verifyCheckoutSignature(orderId, paymentId, signature, keys.secret);
  if (!signatureOk) {
    return json({ error: "Invalid Razorpay checkout signature." }, 401, env, request);
  }

  const payment = await fetchRazorpayPayment(keys, paymentId);
  const result = await processCapturedPayment(env, token, {
    payment,
    order,
    orderId,
    source: "checkout_signature"
  });

  if (!result.paid) {
    await firestorePatch(env, token, `orders/${orderId}`, {
      status: payment.status || "created",
      clientVerifiedAt: new Date().toISOString(),
      razorpayPaymentId: payment.id,
      updatedAt: new Date().toISOString()
    });
  }

  return json({
    ok: true,
    status: result.status,
    paid: result.paid === true,
    opensAt: OPENS_AT
  }, 200, env, request);
}

// ---------- webhook (live mode) ----------

async function handleRazorpayWebhook(request, env) {
  assertEnv(env, [...FIREBASE_ENV, ...RAZORPAY_ENV, "RAZORPAY_WEBHOOK_SECRET"]);
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  const verified = await verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
  if (!verified) {
    return json({ error: "Invalid webhook signature." }, 401, env, request);
  }

  const event = JSON.parse(rawBody);
  const eventId = firestoreDocId(
    request.headers.get("x-razorpay-event-id"),
    `${event.event || "event"}_${event.created_at || Date.now()}`
  );
  const token = await googleAccessToken(env);
  const existingEvent = await firestoreGet(env, token, `webhookEvents/${eventId}`);
  if (existingEvent?.processed === true) {
    return json({ ok: true, duplicate: true }, 200, env, request);
  }

  await firestorePatch(env, token, `webhookEvents/${eventId}`, {
    event: event.event || "",
    receivedAt: existingEvent?.receivedAt || new Date().toISOString(),
    lastReceivedAt: new Date().toISOString(),
    processed: false
  });

  const payment = event.payload?.payment?.entity;
  if (event.event !== "payment.captured" || !payment) {
    await firestorePatch(env, token, `webhookEvents/${eventId}`, {
      processed: true,
      ignored: true,
      reason: "Not a payment.captured event",
      updatedAt: new Date().toISOString()
    });
    return json({ ok: true, ignored: true }, 200, env, request);
  }

  const result = await processCapturedPayment(env, token, {
    payment,
    orderId: payment.order_id,
    source: "razorpay_webhook",
    eventId
  });

  await firestorePatch(env, token, `webhookEvents/${eventId}`, {
    processed: true,
    paymentId: payment.id,
    orderId: payment.order_id,
    paid: result.paid === true,
    updatedAt: new Date().toISOString()
  });

  return json({ ok: true, paid: result.paid === true }, 200, env, request);
}

// ---------- status (polling fallback) ----------

async function handlePaymentStatus(request, env) {
  assertEnv(env, FIREBASE_ENV);
  const buyer = await verifyFirebaseBearer(request, env);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const paymentId = url.searchParams.get("paymentId");
  if (!orderId) return json({ error: "Missing orderId." }, 400, env, request);

  const token = await googleAccessToken(env);
  let order = await firestoreGet(env, token, `orders/${orderId}`);
  if (!order || order.uid !== buyer.localId) {
    return json({ error: "Order not found." }, 404, env, request);
  }

  if (order.status !== "paid") {
    assertEnv(env, RAZORPAY_ENV);
    const keys = razorpayKeys(env, order.test === true);
    // With a payment id, check that payment. Without one (the page missed Razorpay's callback),
    // ask Razorpay for this order's payments and use the captured one.
    let payment = null;
    if (paymentId) {
      payment = await fetchRazorpayPayment(keys, paymentId);
    } else {
      const list = await razorpayRequest(keys, `/v1/orders/${encodeURIComponent(orderId)}/payments`);
      payment = (list.items || []).find((p) => p.status === "captured") || null;
    }
    if (payment && payment.order_id === orderId) {
      await processCapturedPayment(env, token, {
        payment,
        order,
        orderId,
        source: "payment_status_api"
      });
      order = await firestoreGet(env, token, `orders/${orderId}`);
    }
  }

  return json({
    status: order?.status || "created",
    paid: order?.status === "paid",
    opensAt: OPENS_AT,
    razorpayPaymentId: order?.razorpayPaymentId || ""
  }, 200, env, request);
}

// ---------- shared: record a captured payment once ----------

async function processCapturedPayment(env, token, { payment, order, orderId, source, eventId = "" }) {
  if (!payment || !payment.id) {
    throw httpError(400, "Missing Razorpay payment entity.");
  }
  if (payment.status !== "captured") {
    return { status: payment.status || "created", paid: false };
  }

  const actualOrderId = orderId || payment.order_id;
  if (!actualOrderId || payment.order_id !== actualOrderId) {
    throw httpError(400, "Payment order id mismatch.");
  }

  const storedOrder = order || await firestoreGet(env, token, `orders/${actualOrderId}`);
  if (!storedOrder) {
    throw httpError(404, `Order not found: ${actualOrderId}`);
  }

  const existingPayment = await firestoreGet(env, token, `payments/${payment.id}`);
  if (existingPayment?.status === "captured" && storedOrder.status === "paid") {
    return { status: "paid", paid: true, alreadyProcessed: true };
  }

  const plan = PLANS[storedOrder.plan];
  if (!plan) throw httpError(400, `Unknown plan on order: ${storedOrder.plan}`);
  const allowed = [plan.founding, plan.standard];
  if (Number(payment.amount) !== Number(storedOrder.amount) || !allowed.includes(Number(storedOrder.amount))) {
    throw httpError(400, "Payment amount does not match the server-side plan amount.");
  }
  if (String(payment.currency || "").toUpperCase() !== String(storedOrder.currency || plan.currency).toUpperCase()) {
    throw httpError(400, "Payment currency does not match the order currency.");
  }

  const test = storedOrder.test === true;
  const now = new Date().toISOString();
  const seat = {
    status: test ? "test" : storedOrder.tier === "standard" ? "standard" : "founding",
    plan: storedOrder.plan,
    amount: payment.amount,
    currency: payment.currency,
    opensAt: OPENS_AT,
    razorpayOrderId: actualOrderId,
    razorpayPaymentId: payment.id,
    paidAt: now
  };

  // Record the seat on the buyer's profile. The old course access (users.access) is left untouched.
  const existingUser = await firestoreGet(env, token, `users/${storedOrder.uid}`);
  await firestorePatch(env, token, `users/${storedOrder.uid}`, {
    uid: storedOrder.uid,
    name: existingUser?.name || storedOrder.name,
    email: storedOrder.email,
    role: existingUser?.role === "admin" ? "admin" : "student",
    reset: seat,
    updatedAt: now
  });

  await firestorePatch(env, token, `payments/${payment.id}`, {
    uid: storedOrder.uid,
    email: storedOrder.email,
    plan: storedOrder.plan,
    product: plan.product,
    tier: storedOrder.tier || "founding",
    test,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    method: payment.method || "",
    razorpayOrderId: actualOrderId,
    razorpayPaymentId: payment.id,
    source,
    webhookEventId: eventId,
    capturedAt: new Date((payment.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    updatedAt: now
  });

  await firestorePatch(env, token, `orders/${actualOrderId}`, {
    status: "paid",
    razorpayPaymentId: payment.id,
    paidAt: now,
    updatedAt: now
  });

  // Count real founding seats (once per payment: the duplicate check above returns early on repeats).
  if (!test && storedOrder.tier !== "standard") {
    await firestoreIncrement(env, token, "site/founding", "sold", 1);
  }

  // Invoice email (once per payment). An invoice problem never undoes a recorded payment.
  try {
    await issueInvoice(env, token, { payment, storedOrder, test, paidAt: now });
  } catch (error) {
    console.error("invoice failed", String(error && error.message || error));
  }

  if (!test) {
    await notifyPabbly(env, {
      event: "payment_verified",
      uid: storedOrder.uid,
      email: storedOrder.email,
      name: storedOrder.name,
      phone: storedOrder.phone,
      plan: storedOrder.plan,
      tier: storedOrder.tier || "founding",
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method || "",
      razorpayOrderId: actualOrderId,
      razorpayPaymentId: payment.id
    });
  }

  return { status: "paid", paid: true };
}

// ---------- invoices ----------

const SELLER = { name: "Reset Traders", email: "resettradersofficial@gmail.com", site: "www.resettraders.com" };

function money(amount, currency) {
  const value = (Number(amount) / 100).toFixed(2);
  return currency === "INR"
    ? "₹" + Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2 })
    : "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
}

export function invoiceHtml(inv) {
  const opens = new Date(OPENS_AT + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const row = (label, value) => `<tr><td style="padding:6px 0;color:#6b6575;font-size:13px;width:140px;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;font-size:14px;color:#16141b">${value}</td></tr>`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f0ea;font-family:Inter,Segoe UI,Arial,sans-serif;color:#16141b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0ea;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;border:1px solid #e3ddd3">
<tr><td style="padding:28px 28px 8px">
  <table role="presentation" width="100%"><tr>
    <td style="font:800 22px Poppins,Arial,sans-serif;color:#16141b">${esc(SELLER.name)}</td>
    <td align="right" style="font:700 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${inv.test ? "#c2410c" : "#1f4fd1"}">${inv.test ? "Test invoice" : "Invoice"}</td>
  </tr></table>
  <p style="margin:6px 0 0;color:#6b6575;font-size:13px;line-height:1.6">${inv.address ? esc(inv.address) + "<br>" : ""}${esc(SELLER.email)} · ${esc(SELLER.site)}</p>
</td></tr>
<tr><td style="padding:16px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee7dc">
    ${row("Invoice number", `<b>${esc(inv.number)}</b>`)}
    ${row("Date", esc(inv.date))}
    ${row("Billed to", `${esc(inv.name)}<br>${esc(inv.email)}${inv.phone ? "<br>" + esc(inv.phone) : ""}`)}
  </table>
</td></tr>
<tr><td style="padding:18px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7dc;border-radius:12px">
    <tr style="background:#faf7f2"><td style="padding:10px 14px;font:700 12px Arial,sans-serif;color:#6b6575;text-transform:uppercase;letter-spacing:.08em">Item</td><td align="right" style="padding:10px 14px;font:700 12px Arial,sans-serif;color:#6b6575;text-transform:uppercase;letter-spacing:.08em">Amount</td></tr>
    <tr><td style="padding:14px;font-size:14px;line-height:1.5"><b>Your Personal Reset</b> · ${inv.tier === "standard" ? "seat" : "founding seat"}<br><span style="color:#6b6575;font-size:13px">Pre-order. Access in the student portal from ${esc(opens)}. 12 video modules, guided audio, drills for your hijack and Journal Pro.</span></td><td align="right" style="padding:14px;font-size:14px;white-space:nowrap">${esc(money(inv.amount, inv.currency))}</td></tr>
    <tr><td style="padding:12px 14px;border-top:1px solid #eee7dc;font:800 15px Arial,sans-serif">Total paid</td><td align="right" style="padding:12px 14px;border-top:1px solid #eee7dc;font:800 15px Arial,sans-serif;white-space:nowrap">${esc(money(inv.amount, inv.currency))}</td></tr>
  </table>
</td></tr>
<tr><td style="padding:16px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${row("Paid via", `Razorpay${inv.method ? " · " + esc(inv.method) : ""}`)}
    ${row("Payment ID", esc(inv.paymentId))}
    ${row("Order ID", esc(inv.orderId))}
  </table>
</td></tr>
<tr><td style="padding:18px 28px 28px">
  <p style="margin:0;padding:14px 16px;border-radius:12px;background:#f4f7ff;color:#16141b;font-size:13.5px;line-height:1.6">Your seat is confirmed. On ${esc(opens)}, log in at <a href="https://www.resettraders.com/portal.html" style="color:#1f4fd1">resettraders.com/portal.html</a> with this email and the password you created at checkout. If the course is not open by then, reply to this email for a full refund.</p>
  <p style="margin:14px 0 0;color:#8a8494;font-size:12px;line-height:1.6">Educational content only, not investment advice. Trading involves risk. Terms: www.resettraders.com/legal.html</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function issueInvoice(env, token, { payment, storedOrder, test, paidAt }) {
  if (!env.MAILER || !env.INTERNAL_TOKEN) return;
  // Claim the invoice for this payment once; a second caller (webhook vs checkout) gets "already exists".
  const claimed = await firestoreCreate(env, token, "invoices", payment.id, { paymentId: payment.id, status: "claimed", test, createdAt: paidAt });
  if (!claimed) return;
  const n = await firestoreIncrement(env, token, "site/invoices", test ? "test" : "count", 1);
  const date = new Date(paidAt);
  const inv = {
    number: `${test ? "TEST-" : "RT-"}${date.getUTCFullYear()}-${String(n).padStart(4, "0")}`,
    date: date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }),
    name: storedOrder.name,
    email: storedOrder.email,
    phone: storedOrder.phone,
    amount: payment.amount,
    currency: payment.currency,
    tier: storedOrder.tier,
    method: payment.method || "",
    paymentId: payment.id,
    orderId: payment.order_id,
    address: env.INVOICE_ADDRESS || "",
    test
  };
  const response = await env.MAILER.fetch("https://audit-lead.internal/internal/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-token": env.INTERNAL_TOKEN },
    body: JSON.stringify({
      to: storedOrder.email,
      subject: `${test ? "[TEST] " : ""}Your Reset Traders invoice ${inv.number}`,
      html: invoiceHtml(inv),
      tags: ["invoice"]
    })
  });
  await firestorePatch(env, token, `invoices/${payment.id}`, {
    number: inv.number,
    uid: storedOrder.uid,
    email: storedOrder.email,
    amount: payment.amount,
    currency: payment.currency,
    emailed: response.ok,
    status: response.ok ? "sent" : "send_failed",
    updatedAt: new Date().toISOString()
  });
}

// ---------- Firebase auth ----------

async function verifyFirebaseBearer(request, env) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, "Missing login token.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: match[1] })
  });
  const payload = await response.json();
  if (!response.ok || !payload.users?.length) {
    throw httpError(401, "Invalid login token.");
  }
  return payload.users[0];
}

// ---------- Razorpay ----------

async function razorpayRequest(keys, path, options = {}) {
  const method = options.method || (options.body ? "POST" : "GET");
  const headers = {
    "Authorization": `Basic ${btoa(`${keys.id}:${keys.secret}`)}`
  };
  const init = { method, headers };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`https://api.razorpay.com${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, payload.error?.description || "Razorpay API request failed.");
  }
  return payload;
}

async function fetchRazorpayPayment(keys, paymentId) {
  const safePaymentId = String(paymentId || "").trim();
  if (!/^pay_[A-Za-z0-9]+$/.test(safePaymentId)) {
    throw httpError(400, "Invalid Razorpay payment id.");
  }
  return razorpayRequest(keys, `/v1/payments/${encodeURIComponent(safePaymentId)}`);
}

async function verifyCheckoutSignature(orderId, paymentId, signature, secret) {
  return verifyHmac(`${orderId}|${paymentId}`, signature, secret);
}

async function verifyWebhookSignature(rawBody, signature, secret) {
  return verifyHmac(rawBody, signature, secret);
}

async function verifyHmac(message, signature, secret) {
  if (!message || !signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return timingSafeEqual(hex(digest), String(signature).trim());
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------- Google service account ----------

async function googleAccessToken(env) {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60000) {
    return cachedGoogleToken.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }, env.FIREBASE_PRIVATE_KEY);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw httpError(500, payload.error_description || "Could not create Google access token.");
  }
  cachedGoogleToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in * 1000)
  };
  return cachedGoogleToken.token;
}

async function signJwt(claims, privateKeyPem) {
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${base64url(signature)}`;
}

async function importPrivateKey(privateKeyPem) {
  let rawPem = String(privateKeyPem || "").trim();
  if ((rawPem.startsWith("\"") && rawPem.endsWith("\"")) || (rawPem.startsWith("'") && rawPem.endsWith("'"))) {
    try {
      rawPem = JSON.parse(rawPem);
    } catch (_) {
      rawPem = rawPem.slice(1, -1);
    }
  }
  if (rawPem.includes("\"private_key\"")) {
    try {
      const serviceAccount = JSON.parse(rawPem.startsWith("{") ? rawPem : `{${rawPem}}`);
      rawPem = serviceAccount.private_key || rawPem;
    } catch (_) {
      // Fall through to the normal PEM parser so the error message stays helpful.
    }
  }

  const pem = rawPem.replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  let binary;
  try {
    binary = atob(pem);
  } catch (_) {
    throw httpError(500, "FIREBASE_PRIVATE_KEY is not pasted correctly. Use the full Firebase private_key value including BEGIN and END PRIVATE KEY.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// ---------- Firestore REST ----------

async function firestoreGet(env, token, path) {
  const response = await fetch(firestoreUrl(env, path), {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (response.status === 404) return null;
  const payload = await response.json();
  if (!response.ok) throw httpError(response.status, payload.error?.message || "Firestore read failed.");
  return fromFirestoreFields(payload.fields || {});
}

async function firestorePatch(env, token, path, data) {
  const keys = Object.keys(data);
  if (!keys.length) return {};
  const fieldPaths = keys.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
  const response = await fetch(`${firestoreUrl(env, path)}?${fieldPaths}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, payload.error?.message || "Firestore write failed.");
  return payload;
}

// Atomic counter: field += by (creates the document if needed).
async function firestoreIncrement(env, token, path, field, by) {
  const name = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        transform: { document: name, fieldTransforms: [{ fieldPath: field, increment: { integerValue: String(by) } }] }
      }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, payload.error?.message || "Firestore counter update failed.");
  const result = payload.writeResults?.[0]?.transformResults?.[0];
  return Number(result?.integerValue ?? 0);
}

// Create a document only if it doesn't exist yet. Returns false when it already exists.
async function firestoreCreate(env, token, collection, id, data) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${encodeURIComponent(collection)}?documentId=${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });
  if (response.status === 409) return false;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, payload.error?.message || "Firestore create failed.");
  return true;
}

function firestoreUrl(env, path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${encodedPath}`;
}

function toFirestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return { timestampValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  return { mapValue: { fields: toFirestoreFields(value) } };
}

function fromFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function fromFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

// ---------- misc ----------

async function notifyPabbly(env, payload) {
  if (!env.PABBLY_WEBHOOK_URL) return;
  await fetch(env.PABBLY_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) throw httpError(413, "Request body is too large.");
  try {
    return await request.json();
  } catch (_) {
    throw httpError(400, "Invalid JSON body.");
  }
}

function assertEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    throw httpError(500, `Payment server is missing required settings: ${missing.join(", ")}`);
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function firestoreDocId(value, fallback) {
  return String(value || fallback || `event_${Date.now()}`).replace(/\//g, "_").slice(0, 500);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(payload, status, env, request, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env, request),
      ...extra
    }
  });
}

// Only the website itself (and local test servers) may call this from a browser.
// Razorpay's webhook is server-to-server and doesn't send an Origin.
function corsHeaders(env, request) {
  const origin = request?.headers.get("Origin") || "";
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const allowed = new Set([...SITE_ORIGINS, ...configured]);
  const ok = allowed.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Vary": "Origin"
      }
    : { "Vary": "Origin" };
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
