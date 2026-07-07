import { env } from '../config/env';

export type ShopCheckoutResponse = {
  url?: string;
  sessionId?: string;
  error?: string;
};

export type ShopFinalizeResponse = {
  orderId?: string;
  orderNumber?: string;
  email?: string;
  quantity?: number;
  amountPaid?: number;
  alreadyFinalized?: boolean;
  error?: string;
};

export type ShopOrderStatusResponse = {
  status: string;
  orderId?: string;
  orderNumber?: string;
  email?: string;
  quantity?: number;
  amountPaid?: number;
  currency?: string;
  confirmationEmailSent?: boolean;
  error?: string;
};

export async function createObservationBottleCheckout(quantity: number): Promise<ShopCheckoutResponse> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('Checkout API is not configured. Set VITE_API_URL to your backend origin.');
  }
  const res = await fetch(`${env.apiUrl}/api/shop/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  });
  const payload = (await res.json().catch(() => ({}))) as ShopCheckoutResponse;
  if (!res.ok || !payload.url) {
    throw new Error(payload.error || 'Could not start secure checkout.');
  }
  return payload;
}

export async function finalizeShopCheckoutSession(sessionId: string): Promise<ShopFinalizeResponse> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('Checkout API is not configured.');
  }
  const res = await fetch(`${env.apiUrl}/api/shop/finalize-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  const payload = (await res.json().catch(() => ({}))) as ShopFinalizeResponse;
  if (!res.ok || !payload.orderId) {
    throw new Error(payload.error || 'Could not confirm your order.');
  }
  return payload;
}

export async function fetchShopOrderStatus(sessionId: string): Promise<ShopOrderStatusResponse> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('Checkout API is not configured.');
  }
  const res = await fetch(
    `${env.apiUrl}/api/shop/order-status?sessionId=${encodeURIComponent(sessionId)}`
  );
  return (await res.json().catch(() => ({}))) as ShopOrderStatusResponse;
}
