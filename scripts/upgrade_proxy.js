require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const Smartfolio         = artifacts.require("Smartfolio");
const SmartfolioTreasury = artifacts.require("SmartfolioTreasury");
const SmartfolioERC20    = artifacts.require("SmartfolioERC20");

const PROXY = process.env.VITE_CONTRACT_ADDRESS;

module.exports = async function (callback) {
  try {
    const [owner] = await web3.eth.getAccounts();
    console.log("Upgrading from:", owner);
    console.log("Proxy:          ", PROXY);

    const proxy = await Smartfolio.at(PROXY);

    // 1. Deploy new Smartfolio implementation (adds mintWithSMF + receiveSMF entry points)
    const newImpl = await Smartfolio.new({ from: owner });
    console.log("✓ New Smartfolio implementation:", newImpl.address);

    await proxy.upgradeToAndCall(newImpl.address, "0x", { from: owner });
    console.log("✓ Proxy upgraded");

    // 2. Deploy new SmartfolioTreasury (adds mintWithSMF + receiveSMF logic)
    const treasury = await SmartfolioTreasury.new({ from: owner });
    console.log("✓ New SmartfolioTreasury:", treasury.address);

    // setTreasuryFacet requires whenPaused
    await proxy.pause({ from: owner });
    console.log("✓ Proxy paused");

    await proxy.setTreasuryFacet(treasury.address, { from: owner });
    console.log("✓ Treasury facet updated");

    await proxy.unpause({ from: owner });
    console.log("✓ Proxy unpaused");

    // 3. Deploy new SmartfolioERC20 (new mintNFT, addSMFToNFT, addETHToNFT)
    const smf = await SmartfolioERC20.new(PROXY, owner, { from: owner });
    console.log("✓ New SmartfolioERC20:", smf.address);

    // 4. Wire SMF into proxy
    await proxy.setSMFContract(smf.address, { from: owner });
    console.log("✓ SMF contract registered on proxy");

    console.log("\nDone. Summary:");
    console.log("  Proxy:           ", PROXY);
    console.log("  New impl:        ", newImpl.address);
    console.log("  New treasury:    ", treasury.address);
    console.log("  New SMF:         ", smf.address);
    console.log("\nNext steps:");
    console.log("  1. Update VITE_SMF_ADDRESS=" + smf.address + " in frontend/.env and Vercel");
    console.log("  2. Run: npx truffle exec scripts/setNftCostParams.js --network sepolia");
    console.log("  3. Run: npx truffle exec scripts/setTiers.js --network sepolia");
    console.log("  4. Redeploy frontend");

    callback();
  } catch (e) {
    callback(e);
  }
};
