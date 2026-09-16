// Read what an endpoint charges without paying for it.
import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { USDC, formatUsdc, networkByCaip2 } from './arc.js';

export type PriceQuote = {
  url: string;
  status: number;
  /** False when the endpoint answered without asking for payment. */
  paid: boolean;
  description?: string;
  options: {
    scheme: string;
    network: string;
    networkLabel?: string;
    asset: string;
    amount: string;
    usdc?: string;
    payTo: string;
  }[];
};

export async function inspect(url: string, init?: RequestInit): Promise<PriceQuote> {
  const res = await fetch(url, init);
  if (res.status !== 402) {
    return { url, status: res.status, paid: false, options: [] };
  }

  const header = res.headers.get('payment-required');
  const body = header
    ? decodePaymentRequiredHeader(header)
    : ((await res.json().catch(() => null)) as PaymentRequired | null);
  if (!body?.accepts) throw new Error('402 response without payment requirements');

  return {
    url,
    status: 402,
    paid: true,
    description: body.resource?.description,
    options: body.accepts.map((r) => {
      const amount = (r as { amount?: string; maxAmountRequired?: string }).amount
        ?? (r as { maxAmountRequired?: string }).maxAmountRequired
        ?? '0';
      const arc = networkByCaip2(r.network);
      return {
        scheme: r.scheme,
        network: r.network,
        networkLabel: arc?.label,
        asset: r.asset,
        amount,
        // Only label as USDC when it is Arc's USDC.
        usdc: arc && r.asset.toLowerCase() === USDC.address ? formatUsdc(amount) : undefined,
        payTo: r.payTo,
      };
    }),
  };
}
