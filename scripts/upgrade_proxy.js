const Smartfolio         = artifacts.require("Smartfolio");
const SmartfolioTreasury = artifacts.require("SmartfolioTreasury");

const PROXY = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";
const SMF   = "0x1b29D25723045DF0E63905AD1996708Af3f33b93";

module.exports = async function (callback) {
  try {
    const [owner] = await web3.eth.getAccounts();
    console.log("Upgrading from:", owner);

    // Deploy new Smartfolio implementation
    const newImpl = await Smartfolio.new({ from: owner });
    console.log("✓ New Smartfolio implementation:", newImpl.address);

    // Upgrade proxy to new implementation via upgradeTo
    const proxy = await Smartfolio.at(PROXY);
    await proxy.upgradeToAndCall(newImpl.address, "0x", { from: owner });
    console.log("✓ Proxy upgraded");

    // Deploy new SmartfolioTreasury (has mintFunded + addReserve)
    const treasury = await SmartfolioTreasury.new({ from: owner });
    console.log("✓ New SmartfolioTreasury:", treasury.address);

    await proxy.setTreasuryFacet(treasury.address, { from: owner });
    console.log("✓ Treasury facet updated");

    await proxy.setSMFContract(SMF, { from: owner });
    console.log("✓ SMF contract registered");

    console.log("\nDone. Summary:");
    console.log("  Proxy:           ", PROXY);
    console.log("  New impl:        ", newImpl.address);
    console.log("  New treasury:    ", treasury.address);
    console.log("  SMF:             ", SMF);

    callback();
  } catch (e) {
    callback(e);
  }
};
