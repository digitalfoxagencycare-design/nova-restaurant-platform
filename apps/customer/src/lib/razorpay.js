// Razorpay's checkout window. The script is fetched only when a customer pays, and only once.
// Nothing here stores or logs payment values; the three values from Razorpay go straight to the Nova API.
const SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loading = null;

export function loadCheckout() {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("load")));
      s.onerror = () => { loading = null; s.remove(); reject(new Error("load")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Opens the window. onPaid gets the three values Razorpay returns; onDismiss when the customer closes the window; onFailed when a payment attempt fails. */
export async function openCheckout({ checkout, orderNo, name, phone, color, onPaid, onDismiss, onFailed }) {
  const Razorpay = await loadCheckout();
  const rzp = new Razorpay({
    key: checkout.key_id,
    amount: checkout.amount,
    currency: "INR",
    order_id: checkout.order_id,
    name,
    description: `Order #${orderNo}`,
    prefill: { contact: phone || "" },
    theme: { color: color || "#1F6F5C" },
    handler: (response) => onPaid({
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    }),
    modal: { ondismiss: () => onDismiss() },
  });
  rzp.on("payment.failed", (r) => onFailed(r?.error?.description || ""));
  rzp.open();
}
