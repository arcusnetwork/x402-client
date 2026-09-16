# x402-client

Pay [x402](https://www.x402.org) APIs with USDC on [Arc](https://arc.network), from code or the command line.
Built for agents: a drop-in `fetch`, a per-payment cap, and a hard budget.

Pairs with [arcusnetwork/x402-server](https://github.com/arcusnetwork/x402-server). Payments are
settled by the [Arcus facilitator](https://facilitator.arcusnetwork.io), which pays the gas.

```
fetch(url) ──▶ 402 + PAYMENT-REQUIRED
           ──▶ check cap and budget, sign EIP-3009 USDC authorization
           ──▶ retry with PAYMENT-SIGNATURE
           ◀── 200 + PAYMENT-RESPONSE (tx hash on Arc)
```

No approvals and no gas: the wallet only signs. It needs USDC on the network it pays on.
Testnet USDC is at https://faucet.circle.com.

## Install

```bash
git clone https://github.com/arcusnetwork/x402-client.git
cd x402-client
npm install
npm run build
cp .env.example .env    # set PRIVATE_KEY
```

## In code

```ts
import { createArcusClient } from '@arcusnetwork/x402-client';

const arcus = createArcusClient({
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  network: 'arc-testnet',   // or 'arc'
  maxPerPayment: '0.01',    // USDC, refuse anything pricier
  budget: '1',              // USDC, stop signing after this much
  onSign: (p) => console.log(`signed ${p.amount} USDC for ${p.url}`),
});

const res = await arcus.fetch('https://api.example.com/api/weather?city=Tokyo');
console.log(await res.json());

const receipt = arcus.receipt(res);   // { success, transaction, explorer, ... } or null
console.log(receipt?.explorer);

await arcus.balance();     // "4.25"
arcus.committed();         // "0.002"
```

`arcus.fetch` has the same signature as `fetch`. Requests that do not return 402 pass through untouched.

To check a price without paying:

```ts
import { inspect } from '@arcusnetwork/x402-client';

const quote = await inspect('https://api.example.com/api/fact');
// { paid: true, options: [{ usdc: '0.001', network: 'eip155:5042002', payTo: '0x...' }] }
```

### Spending limits

| Option | Default | |
| --- | --- | --- |
| `maxPerPayment` | `0.10` | any single request priced above this is refused before signing |
| `budget` | none | total USDC this client will sign for. Counts every signed authorization, settled or not |

Only Arc USDC on the selected network is accepted. Requests priced in any other asset or network are refused.

## Command line

```bash
npm run cli -- balance
npm run cli -- inspect http://localhost:4021/api/weather
npm run cli -- pay http://localhost:4021/api/fact
npm run cli -- pay "http://localhost:4021/api/weather?city=Tokyo" --max 0.005
npm run cli -- pay http://localhost:4021/api/summarize -d '{"text":"Agents pay per request."}'
```

After `npm run build`, `npm link` exposes it as `x402`:

```
$ x402 inspect http://localhost:4021/api/weather
Current weather for a city (?city=Jakarta)
  0.002 USDC on Arc Testnet (exact) to 0x...

$ x402 pay http://localhost:4021/api/fact
signing 0.001 USDC to 0x...
HTTP 200
{ "fact": "A group of cats is called a clowder." }
settled https://testnet.arcscan.app/tx/0x...
```

| Flag | |
| --- | --- |
| `-X, --method` | HTTP method (GET, or POST when `--data` is set) |
| `-d, --data` | request body, sent as JSON |
| `-H, --header` | extra header, repeatable |
| `-n, --network` | `arc-testnet` (default) or `arc` |
| `--max` | max USDC per payment (default `0.10`) |
| `--json` | machine-readable output |

## Example agent

Run [x402-server](https://github.com/arcusnetwork/x402-server) locally, then:

```bash
npm run example
```

[`examples/agent.ts`](examples/agent.ts) buys three resources with a 0.003 USDC budget.
The third purchase is refused by the budget.

## Networks

| Network | CAIP-2 | USDC | EIP-712 domain |
| --- | --- | --- | --- |
| Arc Mainnet | `eip155:5042` | `0x3600000000000000000000000000000000000000` | `USDC` / `2` |
| Arc Testnet | `eip155:5042002` | `0x3600000000000000000000000000000000000000` | `USDC` / `2` |

## Security

- Use a dedicated wallet holding only what the agent may spend.
- Keep `PRIVATE_KEY` in `.env` or a secret manager. `.env` is git-ignored.
- A signed authorization is valid for the server's timeout window. Only sign for servers you trust.

## License

MIT
