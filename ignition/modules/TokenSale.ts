import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import RWAModule from "./RWA.js";

// Deploys a primary sale on top of the RWA stack and lets it mint tokens.
// startTime and endTime (unix seconds) have no defaults and must be passed
// as Ignition parameters.
export default buildModule("TokenSaleModule", (m) => {
  const { usdc, token } = m.useModule(RWAModule);
  const admin = m.getAccount(0);

  const treasury = m.getParameter("treasury", admin);
  const pricePerToken = m.getParameter("pricePerToken", 50n * 10n ** 6n);
  const softCap = m.getParameter("softCap", 10_000n * 10n ** 18n);
  const hardCap = m.getParameter("hardCap", 40_000n * 10n ** 18n);
  const minPurchase = m.getParameter("minPurchase", 10n ** 18n);
  const startTime = m.getParameter<number>("startTime");
  const endTime = m.getParameter<number>("endTime");

  const sale = m.contract("TokenSale", [
    admin,
    usdc,
    token,
    treasury,
    pricePerToken,
    softCap,
    hardCap,
    minPurchase,
    startTime,
    endTime,
  ]);

  const issuerRole = m.staticCall(token, "ISSUER_ROLE");
  m.call(token, "grantRole", [issuerRole, sale], { id: "token_issuer_sale" });
  m.call(sale, "grantRole", [issuerRole, admin], { id: "sale_issuer" });

  return { sale, usdc, token };
});
