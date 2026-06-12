/**
 * Reads tiers from the old SmartfolioERC20 contract.
 * Usage: npx truffle exec scripts/readOldTiers.js --network sepolia
 */
const SmartfolioERC20 = artifacts.require("SmartfolioERC20");

const OLD_SMF = '0x0364eb7d3805beB98F175f711bCB38439718b49D';

module.exports = async function (callback) {
  try {
    const smf = await SmartfolioERC20.at(OLD_SMF);
    const tiers = await smf.getTiers();
    console.log("\nOld SMF tiers (" + tiers.length + "):");
    tiers.forEach((t, i) => {
      console.log(`  Tier ${i}: threshold=${t.threshold.toString()} pricePerToken=${t.pricePerToken.toString()} wei`);
    });
    callback();
  } catch (err) {
    callback(err);
  }
};
