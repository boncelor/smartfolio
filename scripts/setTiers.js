/**
 * Sets SMF tiers on the new SmartfolioERC20 contract.
 * Usage: npx truffle exec scripts/setTiers.js --network sepolia
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const SmartfolioERC20 = artifacts.require("SmartfolioERC20");

const TIERS = [
  { threshold: '100',   pricePerToken: '1000000000000000'    }, // 0.001 ETH/SMF
  { threshold: '1000',  pricePerToken: '10000000000000000'   }, // 0.01  ETH/SMF
  { threshold: '10000', pricePerToken: '100000000000000000'  }, // 0.1   ETH/SMF
  { threshold: '0',     pricePerToken: '1000000000000000000' }, // 1.0   ETH/SMF
];

module.exports = async function (callback) {
  try {
    const smfAddr = process.env.VITE_SMF_ADDRESS;
    if (!smfAddr || smfAddr === '0x0000000000000000000000000000000000000000')
      throw new Error("VITE_SMF_ADDRESS not set in frontend/.env");

    const smf = await SmartfolioERC20.at(smfAddr);
    console.log("Setting tiers on:", smfAddr);

    const tx = await smf.setTiers(TIERS);
    console.log("✓ setTiers tx:", tx.tx);
    console.log("  Gas used:", tx.receipt.gasUsed);

    // Verify
    const tiers = await smf.getTiers();
    console.log("\nVerified tiers (" + tiers.length + "):");
    tiers.forEach((t, i) => {
      console.log(`  Tier ${i}: threshold=${t.threshold} pricePerToken=${t.pricePerToken} wei`);
    });

    callback();
  } catch (err) {
    callback(err);
  }
};
