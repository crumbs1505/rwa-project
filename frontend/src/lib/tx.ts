import {
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  parseUnits,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type WalletClient,
} from "viem";
import { MockUSDCAbi } from "../abi";
import { addresses, chain, publicClient } from "./chain";

export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

export const fmtUsdc = (v: bigint, digits = 2) =>
  Number(formatUnits(v, USDC_DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const fmtTokens = (v: bigint) =>
  Number(formatUnits(v, TOKEN_DECIMALS)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });

export const parseUsdc = (v: string) => parseUnits(v.trim() || "0", USDC_DECIMALS);
export const parseTokens = (v: string) =>
  parseUnits(v.trim() || "0", TOKEN_DECIMALS);

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Turns viem errors into the contract's revert reason where possible
export function errorMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return revert.reason ?? revert.data?.errorName ?? revert.shortMessage;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface WriteRequest<
  abi extends Abi,
  name extends ContractFunctionName<abi, "nonpayable" | "payable">,
> {
  address: Address;
  abi: abi;
  functionName: name;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", name>;
}

// Simulates first so reverts surface with a reason before the wallet prompt
export async function write<
  const abi extends Abi,
  name extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(wallet: WalletClient, request: WriteRequest<abi, name>) {
  const account = wallet.account!;
  // viem's generics can't follow the request through this wrapper
  const { request: simulated } = await publicClient.simulateContract({
    ...(request as never as Parameters<typeof publicClient.simulateContract>[0]),
    account,
  });
  const hash = await wallet.writeContract({ ...simulated, chain } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  return receipt;
}

// Approves `spender` for `amount` USDC if the current allowance is short
export async function ensureUsdcAllowance(
  wallet: WalletClient,
  spender: Address,
  amount: bigint,
) {
  const owner = wallet.account!.address;
  const allowance = await publicClient.readContract({
    address: addresses.usdc,
    abi: MockUSDCAbi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= amount) return;
  await write(wallet, {
    address: addresses.usdc,
    abi: MockUSDCAbi,
    functionName: "approve",
    args: [spender, amount],
  });
}
