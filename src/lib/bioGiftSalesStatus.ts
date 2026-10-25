import { useEffect, useState } from 'react';
import { env } from '../config/env.js';

export type BioGiftSalesStatus = {
  salesEnabled: boolean;
  storefrontOpen: boolean;
  giftPath: string;
};

const DEFAULT_STATUS: BioGiftSalesStatus = {
  salesEnabled: false,
  storefrontOpen: false,
  giftPath: '/booking/gift',
};

/** Fetch public gift storefront status (safe default: closed). */
export async function fetchBioGiftSalesStatus(signal?: AbortSignal): Promise<BioGiftSalesStatus> {
  if (!env.apiUrlConfigured || !env.apiUrl) return DEFAULT_STATUS;
  try {
    const res = await fetch(`${env.apiUrl}/api/bio-gift/sales-status`, { signal });
    const data = (await res.json().catch(() => ({}))) as Partial<BioGiftSalesStatus>;
    if (!res.ok) return DEFAULT_STATUS;
    return {
      salesEnabled: Boolean(data.salesEnabled),
      storefrontOpen: Boolean(data.storefrontOpen),
      giftPath: String(data.giftPath || '/booking/gift'),
    };
  } catch {
    return DEFAULT_STATUS;
  }
}

/** Header/marketing: show Gift CTA only when storefront is open. */
export function useBioGiftStorefrontOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void fetchBioGiftSalesStatus(ac.signal).then((status) => {
      if (!ac.signal.aborted) setOpen(status.storefrontOpen);
    });
    return () => ac.abort();
  }, []);

  return open;
}
