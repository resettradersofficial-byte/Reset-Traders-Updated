import {
  RESET_CONFIG,
  auth,
  cleanEmail,
  ensureBuyerAccount
} from "./firebase.js?v=20260622-chat-elite-74999";

export const PLANS = {
  course: {
    id: "course",
    name: "The Trader Reset",
    label: "Trader Reset Course",
    amount: 1699900,
    display: "₹16,999",
    access: "lifetime"
  },
  mentorship: {
    id: "mentorship",
    name: "1:1 Elite Mentorship",
    label: "Elite Mentorship",
    amount: 7499900,
    display: "\u20B974,999",
    access: "3_months"
  }
};

let currentPlan = null;
let activeOrderId = null;

function $(id) {
  return document.getElementById(id);
}

function setError(message) {
  const el = $("pay-error");
  if (!el) return;
  el.textContent = message || "";
  el.style.display = message ? "block" : "none";
}

function toggleCheckoutBusy(isBusy) {
  const button = document.querySelector("#modal-payment button[onclick='proceedToRazorpay()']");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? "Preparing secure checkout..." : "\u{1F512} Continue to Payment \u2192";
}

function setSuccessStatus(message, state = "pending") {
  const status = $("success-status");
  if (status) {
    status.textContent = message;
    status.dataset.state = state;
  }

  const icon = $("success-icon");
  if (icon) icon.textContent = state === "verified" ? "OK" : "...";

  const eyebrow = $("success-eyebrow");
  if (eyebrow) eyebrow.textContent = state === "verified" ? "Payment Verified" : "Verifying Payment";

  const heading = $("success-heading");
  if (heading) heading.innerHTML = state === "verified"
    ? "WELCOME TO<br>RESET TRADERS!"
    : "PAYMENT<br>RECEIVED";
}

function openModal(name) {
  const modal = $(`modal-${name}`);
  if (modal) modal.classList.add("active");
}

function closeModal(name) {
  const modal = $(`modal-${name}`);
  if (modal) modal.classList.remove("active");
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").slice(0, 16);
}

function validateCheckout({ name, email, phone, password }) {
  if (!name || name.length < 2) return "Please enter your full name.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Please enter a valid email address.";
  if (normalizePhone(phone).length < 10) return "Please enter a valid phone number.";
  if (!password || password.length < 8) return "Create a portal password with at least 8 characters.";
  return "";
}

async function createRazorpayOrder({ plan, name, email, phone }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in before checkout.");
  const idToken = await user.getIdToken(true);
  const response = await fetch(RESET_CONFIG.createOrderEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({
      plan,
      name,
      email: cleanEmail(email),
      phone: normalizePhone(phone)
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to create a secure Razorpay order.");
  }
  return payload;
}

async function verifyCheckoutPayment(response) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in before payment verification.");
  if (!RESET_CONFIG.verifyPaymentEndpoint) return { status: "created", accessActive: false };

  const idToken = await user.getIdToken(true);
  const serverResponse = await fetch(RESET_CONFIG.verifyPaymentEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature
    })
  });

  const payload = await serverResponse.json().catch(() => ({}));
  if (!serverResponse.ok) {
    throw new Error(payload.error || "Secure payment verification failed.");
  }
  return payload;
}

function openRazorpay({ order, plan, name, email, phone }) {
  if (!window.Razorpay) {
    throw new Error("Razorpay checkout could not load. Please refresh and try again.");
  }

  activeOrderId = order.orderId;
  const rzp = new window.Razorpay({
    key: order.keyId || RESET_CONFIG.razorpayKeyId,
    amount: order.amount,
    currency: order.currency || RESET_CONFIG.currency,
    name: "Reset Traders",
    description: plan.label,
    order_id: order.orderId,
    prefill: {
      name,
      email: cleanEmail(email),
      contact: normalizePhone(phone)
    },
    readonly: {
      email: true,
      contact: true
    },
    notes: {
      plan: plan.id
    },
    theme: {
      color: "#FF6B1A"
    },
    handler: async (response) => {
      closeModal("payment");
      const successEmail = $("success-email");
      if (successEmail) successEmail.textContent = cleanEmail(email);
      setSuccessStatus("Razorpay accepted the payment. Verifying it securely before unlocking course access.", "pending");
      openModal("success");
      try {
        const verification = await verifyCheckoutPayment(response);
        if (verification.status === "paid" || verification.accessActive === true) {
          setSuccessStatus("Payment verified. Your course access is active now.", "verified");
          return;
        }
      } catch (_) {
        setSuccessStatus("Payment received. Waiting for Razorpay webhook verification to finish.", "pending");
      }
      const verifiedByPolling = await pollForAccess(response.razorpay_payment_id);
      if (!verifiedByPolling) {
        setSuccessStatus("Payment is still being verified. Please wait a minute, then open the student portal again.", "pending");
      }
    },
    modal: {
      confirm_close: true,
      ondismiss: () => {
        toggleCheckoutBusy(false);
      }
    }
  });

  rzp.on("payment.failed", (response) => {
    const message = response?.error?.description || "Payment failed. Please try again.";
    setError(message);
    toggleCheckoutBusy(false);
  });

  rzp.open();
}

async function pollForAccess(paymentId) {
  const user = auth.currentUser;
  if (!user || !RESET_CONFIG.paymentStatusEndpoint || !activeOrderId) return false;
  const idToken = await user.getIdToken();
  const url = new URL(RESET_CONFIG.paymentStatusEndpoint);
  url.searchParams.set("orderId", activeOrderId);
  if (paymentId) url.searchParams.set("paymentId", paymentId);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 3000));
    try {
      const response = await fetch(url.toString(), {
        headers: { "Authorization": `Bearer ${idToken}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.status === "paid" || payload.accessActive === true) {
        setSuccessStatus("Payment verified. Your course access is active now.", "verified");
        return true;
      }
    } catch (_) {
      // Keep trying while Razorpay and Firebase finish confirming the payment.
    }
  }
  return false;
}

export function startPayment(planId) {
  const plan = PLANS[planId];
  if (!plan) {
    alert("Unknown plan selected.");
    return;
  }
  currentPlan = plan;
  setError("");
  $("pay-plan-badge").textContent = plan.name;
  $("pay-desc").textContent = plan.label;
  $("pay-amount").textContent = plan.display;
  $("pay-name").value = auth.currentUser?.displayName || "";
  $("pay-email").value = auth.currentUser?.email || "";
  $("pay-phone").value = "";
  $("pay-password").value = "";
  toggleCheckoutBusy(false);
  openModal("payment");
}

export async function proceedToRazorpay() {
  if (!currentPlan) {
    setError("Please choose a plan first.");
    return;
  }
  const data = {
    name: $("pay-name").value.trim(),
    email: cleanEmail($("pay-email").value),
    phone: $("pay-phone").value.trim(),
    password: $("pay-password").value
  };
  const validationError = validateCheckout(data);
  if (validationError) {
    setError(validationError);
    return;
  }

  try {
    setError("");
    toggleCheckoutBusy(true);
    await ensureBuyerAccount(data);
    const order = await createRazorpayOrder({
      plan: currentPlan.id,
      name: data.name,
      email: data.email,
      phone: data.phone
    });
    openRazorpay({
      order,
      plan: currentPlan,
      name: data.name,
      email: data.email,
      phone: data.phone
    });
  } catch (error) {
    const message = error?.message === "Failed to fetch"
      ? "Payment server is live, but this website is not allowed to call it yet. Check Cloudflare ALLOWED_ORIGINS includes https://resettraders.com, then redeploy the Worker."
      : (error.message || "Checkout could not start. Please try again.");
    setError(message);
    toggleCheckoutBusy(false);
  }
}
