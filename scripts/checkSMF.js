/**
 * Reads key state from the deployed SmartfolioERC20 contract.
 * Usage: npx truffle exec scripts/checkSMF.js --network sepolia
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const SmartfolioERC20 = artifacts.require("SmartfolioERC20");

module.exports = async function (callback) {
  try {
    const smfAddr = process.env.VITE_SMF_ADDRESS;
    if (!smfAddr || smfAddr === '0x0000000000000000000000000000000000000000')
      throw new Error("VITE_SMF_ADDRESS not set in frontend/.env");

    const smf = await SmartfolioERC20.at(smfAddr);

    const tiers = await smf.getTiers();
    const smartfolio = await smf.smartfolio();
    const smfTotalSupply = await smf.smfTotalSupply();
    const nftCount = await smf.nftCount();
    const nftGrace = await smf.nftGrace();
    const nftCostMin = await smf.nftCostMin();
    const nftCostBase = await smf.nftCostBase();
    const nftRatioScale = await smf.nftRatioScale();

    console.log("\n=== SmartfolioERC20 state ===");
    console.log("  Address:      ", smfAddr);
    console.log("  smartfolio:   ", smartfolio);
    console.log("  smfTotalSupply:", smfTotalSupply.toString());
    console.log("  nftCount:     ", nftCount.toString());

    console.log("\n--- NFT cost params ---");
    console.log("  nftGrace:     ", nftGrace.toString());
    console.log("  nftCostMin:   ", nftCostMin.toString(), "(wei)");
    console.log("  nftCostBase:  ", nftCostBase.toString(), "(wei)");
    console.log("  nftRatioScale:", nftRatioScale.toString());

    console.log("\n--- SMF tiers (" + tiers.length + ") ---");
    if (tiers.length === 0) {
      console.log("  ⚠️  NO TIERS SET — call setTiers() before any minting!");
    } else {
      tiers.forEach((t, i) => {
        console.log(`  Tier ${i}: threshold=${t.threshold.toString()} pricePerToken=${t.pricePerToken.toString()} wei`);
      });
    }

    // Simulate mint cost
    try {
      const { smfRequired, ethNeeded } = await smf.smfForNFT();
      console.log("\n--- smfForNFT() simulation ---");
      console.log("  smfRequired:", smfRequired.toString());
      console.log("  ethNeeded:  ", ethNeeded.toString());
    } catch (e) {
      console.log("\n--- smfForNFT() simulation ---");
      console.log("  ⚠️  Reverted:", e.message);
    }

    callback();
  } catch (err) {
    callback(err);
  }
};
