// Arc networks and the native USDC predeploy.
import { defineChain, type Chain } from 'viem';

export type ArcNetworkId = 'arc' | 'arc-testnet';

export type ArcNetwork = {
  id: ArcNetworkId;
  label: string;
  caip2: `eip155:${number}`;
  rpcUrl: string;
  explorer: string;
  chain: Chain;
};

// Same address on both networks. 6 decimals on the ERC-20 interface,
// supports EIP-3009 transferWithAuthorization. EIP-712 domain: USDC / 2.
export const USDC = {
  address: '0x3600000000000000000000000000000000000000',
  decimals: 6,
  name: 'USDC',
  version: '2',
} as const;

function arcChain(id: number, name: string, rpcUrl: string, explorer: string, testnet: boolean) {
  return defineChain({
    id,
    name,
    testnet,
    // Gas on Arc is paid in USDC (18 decimals natively).
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'Arcscan', url: explorer } },
  });
}

function network(
  id: ArcNetworkId,
  label: string,
  chainId: number,
  rpcUrl: string,
  explorer: string,
): ArcNetwork {
  return {
    id,
    label,
    caip2: `eip155:${chainId}`,
    rpcUrl,
    explorer,
    chain: arcChain(chainId, label, rpcUrl, explorer, id !== 'arc'),
  };
}

export const NETWORKS: Record<ArcNetworkId, ArcNetwork> = {
  arc: network(
    'arc',
    'Arc Mainnet',
    5042,
    process.env.ARC_RPC_URL || 'https://rpc.mainnet.arc.io',
    'https://www.arcexplorer.org',
  ),
  'arc-testnet': network(
    'arc-testnet',
    'Arc Testnet',
    5042002,
    process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network',
    'https://testnet.arcscan.app',
  ),
};

export function getNetwork(id: string = 'arc-testnet'): ArcNetwork {
  const network = NETWORKS[id as ArcNetworkId];
  if (!network) throw new Error(`Unknown network "${id}". Use one of: ${Object.keys(NETWORKS).join(', ')}`);
  return network;
}

export function networkByCaip2(caip2: string): ArcNetwork | undefined {
  return Object.values(NETWORKS).find((n) => n.caip2 === caip2);
}

// "0.001" -> 1000n
export function parseUsdc(amount: string): bigint {
  const [whole, frac = ''] = amount.trim().split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > USDC.decimals) {
    throw new Error(`Invalid USDC amount: ${amount}`);
  }
  return BigInt(whole + frac.padEnd(USDC.decimals, '0'));
}

// 1000n -> "0.001"
export function formatUsdc(atomic: bigint | string): string {
  const value = BigInt(atomic).toString().padStart(USDC.decimals + 1, '0');
  const whole = value.slice(0, -USDC.decimals);
  const frac = value.slice(-USDC.decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export function explorerTx(network: ArcNetwork, hash: string): string {
  return `${network.explorer}/tx/${hash}`;
}
