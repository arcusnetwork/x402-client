#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import type { Hex } from 'viem';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { createArcusClient } from './client.js';
import { inspect } from './inspect.js';
import { USDC } from './arc.js';

const HELP = `x402: pay x402 APIs with USDC on Arc

Usage
  x402 pay <url> [options]      request a URL, paying if it returns 402
  x402 inspect <url> [options]  show what a URL charges, without paying
  x402 balance [options]        show the wallet address and USDC balance

Options
  -X, --method <method>   HTTP method (default GET, or POST with --data)
  -d, --data <body>       request body, sent as JSON
  -H, --header <k: v>     extra header, repeatable
  -n, --network <id>      arc-testnet (default) or arc
      --max <usdc>        max per payment (default 0.10)
      --json              machine-readable output
  -h, --help

Environment
  PRIVATE_KEY             paying wallet (required for pay and balance)
  NETWORK                 default network
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    method: { type: 'string', short: 'X' },
    data: { type: 'string', short: 'd' },
    header: { type: 'string', short: 'H', multiple: true },
    network: { type: 'string', short: 'n' },
    max: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, url] = positionals;
const network = (values.network || process.env.NETWORK || 'arc-testnet') as 'arc' | 'arc-testnet';

function requestInit(): RequestInit {
  const headers: Record<string, string> = {};
  for (const h of values.header ?? []) {
    const i = h.indexOf(':');
    if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
  }
  if (values.data && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json';
  }
  return {
    method: values.method || (values.data ? 'POST' : 'GET'),
    headers,
    body: values.data,
  };
}

function client() {
  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  if (!privateKey) fail('Set PRIVATE_KEY to the paying wallet key (see .env.example)');
  return createArcusClient({
    privateKey,
    network,
    maxPerPayment: values.max,
    onSign: (p) => {
      if (!values.json) console.error(`signing ${p.amount} USDC to ${p.payTo}`);
    },
  });
}

// A 402 after paying carries the reason in PAYMENT-REQUIRED.
function paymentError(res: Response): string | undefined {
  const header = res.status === 402 ? res.headers.get('payment-required') : null;
  if (!header) return undefined;
  try {
    return decodePaymentRequiredHeader(header).error || 'payment required';
  } catch {
    return 'payment required';
  }
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function print(data: unknown) {
  console.log(values.json ? JSON.stringify(data) : typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function main() {
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'pay': {
      if (!url) fail('pay needs a URL');
      const arcus = client();
      const res = await arcus.fetch(url, requestInit());
      const type = res.headers.get('content-type') ?? '';
      const body = type.includes('json') ? await res.json() : await res.text();
      const receipt = arcus.receipt(res);
      const rejected = paymentError(res);
      if (values.json) {
        print({ status: res.status, body, receipt, ...(rejected ? { error: rejected } : {}) });
      } else {
        console.error(`HTTP ${res.status}`);
        print(body);
        if (rejected) console.error(`payment rejected: ${rejected}`);
        if (receipt?.explorer) console.error(`settled ${receipt.explorer}`);
      }
      if (!res.ok) process.exitCode = 1;
      return;
    }

    case 'inspect': {
      if (!url) fail('inspect needs a URL');
      const quote = await inspect(url, requestInit());
      if (values.json) return print(quote);
      if (!quote.paid) return print(`HTTP ${quote.status}: no payment required`);
      if (quote.description) console.log(quote.description);
      for (const o of quote.options) {
        const price = o.usdc ? `${o.usdc} USDC` : `${o.amount} of ${o.asset}`;
        console.log(`  ${price} on ${o.networkLabel ?? o.network} (${o.scheme}) to ${o.payTo}`);
      }
      return;
    }

    case 'balance': {
      const arcus = client();
      const balance = await arcus.balance();
      if (values.json) {
        return print({ address: arcus.account.address, network: arcus.network.caip2, asset: USDC.address, balance });
      }
      console.log(`${arcus.account.address}`);
      console.log(`${balance} USDC on ${arcus.network.label}`);
      return;
    }

    default:
      fail(`unknown command "${command}". Run x402 --help`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
