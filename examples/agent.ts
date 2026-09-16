// An agent that pays for data with a hard spending budget.
//   PRIVATE_KEY=0x... SERVER_URL=http://localhost:4021 npm run example
import 'dotenv/config';
import type { Hex } from 'viem';
import { createArcusClient } from '../src/index.js';

const server = process.env.SERVER_URL || 'http://localhost:4021';

const arcus = createArcusClient({
  privateKey: process.env.PRIVATE_KEY as Hex,
  network: 'arc-testnet',
  maxPerPayment: '0.01',
  budget: '0.003',
  onSign: (p) => console.log(`  signed ${p.amount} USDC for ${p.url}`),
});

console.log(`agent ${arcus.account.address}, balance ${await arcus.balance()} USDC`);

for (const path of ['/api/fact', '/api/weather?city=Tokyo', '/api/fact']) {
  try {
    const res = await arcus.fetch(`${server}${path}`);
    console.log(path, res.status, await res.json());
    const receipt = arcus.receipt(res);
    if (receipt?.explorer) console.log(`  ${receipt.explorer}`);
  } catch (error) {
    // The budget check aborts payment creation and surfaces here.
    console.log(path, 'skipped:', error instanceof Error ? error.message : error);
  }
}

console.log(`committed ${arcus.committed()} USDC`);
