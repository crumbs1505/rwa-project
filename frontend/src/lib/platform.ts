import { keccak256, toHex, zeroAddress, type Address } from "viem";
import {
  AssetFactoryAbi,
  AssetRegistryAbi,
  MockUSDCAbi,
  RWATokenAbi,
  TokenSaleAbi,
  YieldDistributorAbi,
} from "../abi";
import { addresses, publicClient, saleFor } from "./chain";

export const ROLES = {
  admin: "0x0000000000000000000000000000000000000000000000000000000000000000",
  issuer: keccak256(toHex("ISSUER_ROLE")),
  compliance: keccak256(toHex("COMPLIANCE_ROLE")),
} as const;

export enum SaleState {
  Active,
  Succeeded,
  Failed,
}

export interface SaleInfo {
  address: Address;
  state: SaleState;
  isOpen: boolean;
  pricePerToken: bigint;
  softCap: bigint;
  hardCap: bigint;
  minPurchase: bigint;
  tokensSold: bigint;
  startTime: number;
  endTime: number;
  myTokensPurchased: bigint;
  myAmountPaid: bigint;
  iAmIssuer: boolean;
}

export interface AssetInfo {
  id: bigint;
  name: string;
  symbol: string;
  valuation: bigint;
  legalDocHash: `0x${string}`;
  token: Address;
  active: boolean;
  distributor: Address;
  totalSupply: bigint;
  totalIncome: bigint;
  myBalance: bigint;
  myPendingYield: bigint;
  amWhitelisted: boolean;
  amFrozen: boolean;
  iAmIssuer: boolean;
  iAmCompliance: boolean;
  sale?: SaleInfo;
}

export interface PlatformState {
  assets: AssetInfo[];
  myUsdc: bigint;
  canLaunch: boolean;
  canManageRegistry: boolean;
}

const read = publicClient.readContract;

async function loadSale(sale: Address, me: Address): Promise<SaleInfo> {
  const c = { address: sale, abi: TokenSaleAbi } as const;
  const [
    state,
    isOpen,
    pricePerToken,
    softCap,
    hardCap,
    minPurchase,
    tokensSold,
    startTime,
    endTime,
    myTokensPurchased,
    myAmountPaid,
    iAmIssuer,
  ] = await Promise.all([
    read({ ...c, functionName: "state" }),
    read({ ...c, functionName: "isOpen" }),
    read({ ...c, functionName: "pricePerToken" }),
    read({ ...c, functionName: "softCap" }),
    read({ ...c, functionName: "hardCap" }),
    read({ ...c, functionName: "minPurchase" }),
    read({ ...c, functionName: "tokensSold" }),
    read({ ...c, functionName: "startTime" }),
    read({ ...c, functionName: "endTime" }),
    read({ ...c, functionName: "tokensPurchased", args: [me] }),
    read({ ...c, functionName: "amountPaid", args: [me] }),
    read({ ...c, functionName: "hasRole", args: [ROLES.issuer, me] }),
  ]);
  return {
    address: sale,
    state: state as SaleState,
    isOpen,
    pricePerToken,
    softCap,
    hardCap,
    minPurchase,
    tokensSold,
    startTime: Number(startTime),
    endTime: Number(endTime),
    myTokensPurchased,
    myAmountPaid,
    iAmIssuer,
  };
}

async function loadAsset(id: bigint, me: Address): Promise<AssetInfo> {
  const [name, valuation, legalDocHash, token, active] = await read({
    address: addresses.registry,
    abi: AssetRegistryAbi,
    functionName: "assets",
    args: [id],
  });

  const t = { address: token, abi: RWATokenAbi } as const;
  const [
    symbol,
    totalSupply,
    myBalance,
    amWhitelisted,
    amFrozen,
    distributor,
    iAmIssuer,
    iAmCompliance,
  ] = await Promise.all([
    read({ ...t, functionName: "symbol" }),
    read({ ...t, functionName: "totalSupply" }),
    read({ ...t, functionName: "balanceOf", args: [me] }),
    read({ ...t, functionName: "whitelist", args: [me] }),
    read({ ...t, functionName: "frozen", args: [me] }),
    read({ ...t, functionName: "yieldDistributor" }),
    read({ ...t, functionName: "hasRole", args: [ROLES.issuer, me] }),
    read({ ...t, functionName: "hasRole", args: [ROLES.compliance, me] }),
  ]);

  let myPendingYield = 0n;
  let totalIncome = 0n;
  if (distributor !== zeroAddress) {
    const d = { address: distributor, abi: YieldDistributorAbi } as const;
    [myPendingYield, totalIncome] = await Promise.all([
      read({ ...d, functionName: "calculatePendingYield", args: [me] }),
      read({ ...d, functionName: "totalRentalIncomeDeposited" }),
    ]);
  }

  const saleAddress = saleFor(token);
  const sale = saleAddress ? await loadSale(saleAddress, me) : undefined;

  return {
    id,
    name,
    symbol,
    valuation,
    legalDocHash,
    token,
    active,
    distributor,
    totalSupply,
    totalIncome,
    myBalance,
    myPendingYield,
    amWhitelisted,
    amFrozen,
    iAmIssuer,
    iAmCompliance,
    sale,
  };
}

export async function loadPlatform(me: Address): Promise<PlatformState> {
  const [count, myUsdc, canLaunch, canManageRegistry] = await Promise.all([
    read({
      address: addresses.registry,
      abi: AssetRegistryAbi,
      functionName: "assetCount",
    }),
    read({
      address: addresses.usdc,
      abi: MockUSDCAbi,
      functionName: "balanceOf",
      args: [me],
    }),
    read({
      address: addresses.factory,
      abi: AssetFactoryAbi,
      functionName: "hasRole",
      args: [ROLES.issuer, me],
    }),
    read({
      address: addresses.registry,
      abi: AssetRegistryAbi,
      functionName: "hasRole",
      args: [ROLES.issuer, me],
    }),
  ]);

  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const assets = await Promise.all(ids.map((id) => loadAsset(id, me)));
  return { assets, myUsdc, canLaunch, canManageRegistry };
}
