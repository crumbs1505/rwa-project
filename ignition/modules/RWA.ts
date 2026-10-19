import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys the full RWA stack for one tokenized property and wires it together.
// The deployer becomes admin and holds every operational role; hand those
// roles to dedicated accounts after deployment.
export default buildModule("RWAModule", (m) => {
  const admin = m.getAccount(0);

  const name = m.getParameter("name", "Main Street Property");
  const symbol = m.getParameter("symbol", "MSP");
  const valuation = m.getParameter("valuation", 2_000_000n * 10n ** 6n);
  const legalDocHash = m.getParameter(
    "legalDocHash",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  );

  const usdc = m.contract("MockUSDC", [admin]);
  const token = m.contract("RWAToken", [name, symbol, admin]);
  const distributor = m.contract("YieldDistributor", [admin, usdc, token]);
  const registry = m.contract("AssetRegistry", [admin]);

  m.call(token, "setYieldDistributor", [distributor]);

  const issuerRole = m.staticCall(token, "ISSUER_ROLE");
  const complianceRole = m.staticCall(token, "COMPLIANCE_ROLE");
  const pauserRole = m.staticCall(token, "PAUSER_ROLE");

  m.call(token, "grantRole", [issuerRole, admin], { id: "token_issuer" });
  m.call(token, "grantRole", [complianceRole, admin], {
    id: "token_compliance",
  });
  m.call(token, "grantRole", [pauserRole, admin], { id: "token_pauser" });
  m.call(distributor, "grantRole", [issuerRole, admin], {
    id: "distributor_issuer",
  });
  const registryIssuer = m.call(registry, "grantRole", [issuerRole, admin], {
    id: "registry_issuer",
  });

  m.call(registry, "registerAsset", [name, valuation, legalDocHash, token], {
    after: [registryIssuer],
  });

  return { usdc, token, distributor, registry };
});
