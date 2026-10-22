import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys the multi-property platform: a shared registry and a factory that
// launches each new property (token + yield distributor) in one call.
// Yield is paid in a freshly deployed MockUSDC, which suits local and
// testnet demos.
export default buildModule("PlatformModule", (m) => {
  const admin = m.getAccount(0);

  const mockUsdc = m.contract("MockUSDC", [admin]);

  const registry = m.contract("AssetRegistry", [admin]);
  const factory = m.contract("AssetFactory", [admin, registry, mockUsdc]);

  const issuerRole = m.staticCall(registry, "ISSUER_ROLE");
  m.call(registry, "grantRole", [issuerRole, factory], {
    id: "registry_issuer_factory",
  });
  m.call(factory, "grantRole", [issuerRole, admin], { id: "factory_issuer" });

  return { registry, factory, mockUsdc };
});
