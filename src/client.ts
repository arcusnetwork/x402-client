import { createPublicClient, erc20Abi, http, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import type { PaymentRequirements } from '@x402/core/types';
import {
  USDC,
  explorerTx,
  formatUsdc,
  getNetwork,
  parseUsdc,
  type ArcNetwork,
  type ArcNetworkId,
} from './arc.js';

export type ArcusClientOptions = {
  /** Hex private key of the paying wallet. */
  privateKey: Hex;
  /** Defaults to arc-testnet. */
  network?: ArcNetworkId;
  /** Refuse any single payment above this, in USDC. Defaults to "0.10". */
  maxPerPayment?: string;
  /**
   * Refuse to sign once this much USDC has been committed by this client.
   * Counts every signed authorization, settled or not, so it is a worst case.
   */
  budget?: string;
  /** Called when a payment is signed, before the request is retried. */
  onSign?: (payment: SignedPayment) => void;
};

export type SignedPayment = {
  url: string;
  amount: string;
  payTo: string;
  network: string;
};

export type Receipt = {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  explorer?: string;
};

export type ArcusClient = {
  account: PrivateKeyAccount;
  network: ArcNetwork;
  /** Drop-in fetch that pays 402 responses automatically. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Settlement receipt from a paid response, or null if nothing was paid. */
  receipt: (response: Response) => Receipt | null;
  /** Wallet USDC balance, formatted. */
  balance: () => Promise<string>;
  /** Total USDC this client has signed authorizations for, formatted. */
  committed: () => string;
};

export function createArcusClient(options: ArcusClientOptions): ArcusClient {
  const network = getNetwork(options.network);
  const account = privateKeyToAccount(options.privateKey);
  const maxPerPayment = parseUsdc(options.maxPerPayment ?? '0.10');
  const budget = options.budget ? parseUsdc(options.budget) : undefined;
  let committed = 0n;

  const client = x402Client
    .fromConfig({
      schemes: [{ network: network.caip2, client: new ExactEvmScheme(account) }],
      // Arc USDC is not an SDK default asset, so it must be allowlisted.
      spendControls: {
        allowedAssets: [
          { network: network.caip2, asset: USDC.address, maxAmountPerPayment: maxPerPayment.toString() },
        ],
      },
    })
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const amount = BigInt(amountOf(selectedRequirements));
      if (budget !== undefined && committed + amount > budget) {
        return {
          abort: true,
          reason: `Budget exceeded: ${formatUsdc(committed)} of ${formatUsdc(budget)} USDC committed, request costs ${formatUsdc(amount)}`,
        };
      }
    })
    .onAfterPaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
      const amount = amountOf(selectedRequirements);
      committed += BigInt(amount);
      options.onSign?.({
        url: paymentRequired.resource?.url ?? '',
        amount: formatUsdc(amount),
        payTo: selectedRequirements.payTo,
        network: selectedRequirements.network,
      });
    });

  const rpc = createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) });

  return {
    account,
    network,
    fetch: wrapFetchWithPayment(fetch, client),
    receipt(response) {
      const header = response.headers.get('payment-response') ?? response.headers.get('x-payment-response');
      if (!header) return null;
      const settled = decodePaymentResponseHeader(header);
      return {
        success: settled.success,
        transaction: settled.transaction,
        network: settled.network,
        payer: settled.payer,
        explorer: settled.transaction ? explorerTx(network, settled.transaction) : undefined,
      };
    },
    async balance() {
      const value = await rpc.readContract({
        address: USDC.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      return formatUsdc(value);
    },
    committed: () => formatUsdc(committed),
  };
}

function amountOf(requirements: PaymentRequirements): string {
  // v2 uses `amount`; older servers send `maxAmountRequired`.
  const r = requirements as PaymentRequirements & { maxAmountRequired?: string };
  return r.amount ?? r.maxAmountRequired ?? '0';
}
