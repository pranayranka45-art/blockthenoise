// Payment settings for the free trial and the one-time purchase.
// Fill in the Dodo Payments values from your dashboard before publishing; `npm run package` refuses to build until you do.

export const TRIAL_DAYS = 14;
export const PRICE_LABEL = "₹800";

/** "test" while you try purchases with Dodo's test mode; switch to "live" before publishing. */
export const DODO_MODE = "test" as "test" | "live";

/** ID of the BlockTheNoise one-time product in Dodo Payments, e.g. "pdt_...". Keys for other products are rejected. */
export const DODO_PRODUCT_ID = "";

/** Payment link for that product, copied from the Dodo dashboard. The buy button opens it. */
export const CHECKOUT_URL = "";

export const DODO_API_BASE = DODO_MODE === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com";
