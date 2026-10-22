import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import deployments from "../deployments.json";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const RPC_URL: string =
  import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";

export const chain = defineChain({
  id: deployments.chainId,
  name: deployments.chainId === 31337 ? "Hardhat" : `Chain ${deployments.chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

export const addresses = {
  usdc: deployments.usdc as Address,
  registry: deployments.registry as Address,
  factory: deployments.factory as Address,
  sales: deployments.sales as Record<string, Address>,
};

export function saleFor(token: Address): Address | undefined {
  const entry = Object.entries(addresses.sales).find(
    ([t]) => t.toLowerCase() === token.toLowerCase(),
  );
  return entry?.[1];
}

// Connects the injected wallet and makes sure it is on the app's chain
export async function connectWallet(): Promise<{
  account: Address;
  wallet: WalletClient;
}> {
  const provider = window.ethereum;
  if (!provider) {
    throw new Error("No browser wallet found. Install MetaMask or a similar wallet.");
  }

  const [account] = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];

  const currentChain = await provider.request({ method: "eth_chainId" });
  if (Number(currentChain) !== chain.id) {
    const chainIdHex = `0x${chain.id.toString(16)}` as const;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [RPC_URL],
          },
        ],
      });
    }
  }

  const wallet = createWalletClient({
    account,
    chain,
    transport: custom(provider),
  });
  return { account, wallet };
}
