import { money } from "@nova/shared";

/** Turn an API error into a message people understand plus the best next step.
 *  action: "menu" | "takeaway" | "address" | "location" | "table" | "signin" | "coupon" | "refresh" | "wait" | "call" | "dish" | null */
export function describeError(err, { storefront } = {}) {
  const code = err?.code || "ERROR";
  const d = err?.details || {};
  const notice = storefront?.ordering?.notice;
  switch (code) {
    case "STORE_PAUSED":
      return { code, message: d.message || notice || "The restaurant is not taking online orders right now.", action: "wait", label: "Try again later" };
    case "CHANNEL_OFF":
      return { code, message: "This kind of order is not available right now. Pick another way to order.", action: "refresh", label: "Choose another" };
    case "OUT_OF_STOCK":
      return { code, message: `${(d.message || "A dish").replace(/ is sold out$/, "")} just sold out. We removed it from your cart.`, action: "dish", label: "Back to menu", itemId: d.item_id };
    case "BELOW_MINIMUM":
      return { code, message: `The minimum order is ${money(d.min_order ?? storefront?.ordering?.min_order ?? 0)}. Add a little more to continue.`, action: "menu", label: "Add more dishes" };
    case "OUT_OF_DELIVERY_RANGE":
      return { code, message: `This address is ${d.distance_km ?? "?"} km away and we deliver within ${d.max_km ?? "?"} km. Try another address or pick up the order yourself.`, action: "takeaway", label: "Switch to takeaway" };
    case "LOCATION_REQUIRED":
      return { code, message: "Please share your location so we can check that we deliver to you.", action: "location", label: "Use my location" };
    case "ADDRESS_REQUIRED":
      return { code, message: "Enter your full delivery address (at least a few words).", action: "address", label: "Enter address" };
    case "BAD_TABLE":
      return { code, message: "Pick your table number, or scan the QR code on your table.", action: "table", label: "Pick a table" };
    case "COUPON_INVALID":
      return { code, message: "This coupon is not valid. Check the code or try another.", action: "coupon", label: "Change coupon" };
    case "COUPON_MIN":
      return { code, message: d.message || "Add more to your cart to use this coupon.", action: "menu", label: "Add more dishes" };
    case "COD_UNAVAILABLE":
      return { code, message: "Pay-on-delivery is not available at this hour. Please order again a little later.", action: "wait", label: "OK" };
    case "PAYMENT_NOT_AVAILABLE":
      return { code, message: "Online payment is not available right now. You can pay on delivery or at the counter instead.", action: null };
    case "PAYMENT_SIGNATURE":
      return { code, message: "We could not verify your payment. If money was taken from your account it will be returned. Please try again or call the restaurant.", action: "call", label: "Call restaurant" };
    case "PAYMENT_MISMATCH":
      return { code, message: "This payment does not belong to this order. If money was taken from your account, call the restaurant.", action: "call", label: "Call restaurant" };
    case "PAYMENT_PROVIDER_DOWN":
      return { code, message: "The payment service is not answering. Please try again in a minute.", action: null };
    case "PAYMENT_PROVIDER_ERROR":
      return { code, message: err?.message && err.message !== "Something went wrong" ? err.message : "The payment service could not start this payment. Please try again.", action: null };
    case "REFUND_FAILED":
      return { code, message: "We could not send your refund, so the order was not cancelled. Please try again in a minute.", action: null };
    case "NOT_PENDING":
      return { code, message: "This order is no longer waiting for payment.", action: "refresh", label: "Refresh" };
    case "TOO_MANY_ACTIVE":
      return { code, message: "You already have several orders in progress. Wait for one to finish, then order again.", action: "orders", label: "See my orders" };
    case "TOO_LATE":
      return { code, message: d.message || "The kitchen has already started. Please call the restaurant to cancel.", action: "call", label: "Call restaurant" };
    case "OTP_INVALID":
      return { code, message: "That code is wrong or has expired. Check it and try again, or ask for a new one.", action: null };
    case "OTP_LOCKED":
      return { code, message: "Too many wrong tries. Ask for a new code.", action: "resend", label: "Send a new code" };
    case "OTP_LIMIT":
      return { code, message: "Too many codes requested. Please try again in an hour.", action: null };
    case "OTP_NOT_CONFIGURED":
      return { code, message: "Sign-in codes are not set up for this restaurant yet. Please call the restaurant to order.", action: "call", label: "Call restaurant" };
    case "BAD_PHONE":
      return { code, message: "Enter a valid 10-digit mobile number.", action: null };
    case "BLOCKED":
      return { code, message: "This number cannot place orders. Please contact the restaurant.", action: "call", label: "Call restaurant" };
    case "NETWORK":
    case "TIMEOUT":
      return { code, message: err.message, action: "refresh", label: "Try again" };
    case "NOT_FOUND":
      return { code, message: d.message || "We could not find that.", action: null };
    default:
      return { code, message: err?.message && err.message !== "Something went wrong" ? err.message : "Something went wrong. Please try again.", action: null };
  }
}
