import { createContext, useContext } from "react";

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Rights that /v2/pos/rules does not report (it lists the counter permissions only). They mirror the built-in role table;
// any call the server still refuses is shown as a plain "not allowed" message.
const ROLE_EXTRA = {
  owner: ["*"],
  manager: ["orders.view", "orders.update", "customers.view", "coupons.view", "coupons.edit", "users.view", "config.view"],
  cashier: ["orders.view", "orders.update", "customers.view", "config.view"],
};

export function makeCan(role, posPerms) {
  const extra = ROLE_EXTRA[role] || [];
  return (perm) => role === "owner" || extra.includes("*") || extra.includes(perm) || (posPerms || []).includes(perm);
}

export const DEFAULT_FLOWS = {
  "dine-in": ["placed", "preparing", "ready", "served", "completed"],
  takeaway: ["placed", "preparing", "ready", "completed"],
  delivery: ["placed", "preparing", "ready", "out_for_delivery", "delivered"],
};
