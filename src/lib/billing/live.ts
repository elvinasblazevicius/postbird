/**
 * Is real billing (Paddle) switched on? Safe to import in client components.
 * Until all three public values are set, the site keeps the early-access
 * sign-up and charges nothing.
 */
export const PADDLE_CLIENT_TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
export const PADDLE_PRICE_MONTHLY = process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY ?? "";
export const PADDLE_PRICE_QUARTERLY = process.env.NEXT_PUBLIC_PADDLE_PRICE_QUARTERLY ?? "";
export const PADDLE_ENV: "sandbox" | "production" = process.env.NEXT_PUBLIC_PADDLE_ENV === "production" ? "production" : "sandbox";

export const BILLING_LIVE = Boolean(PADDLE_CLIENT_TOKEN && PADDLE_PRICE_MONTHLY && PADDLE_PRICE_QUARTERLY);
