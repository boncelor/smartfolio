/**
 * Resets NFT minting cost params to raw-unit values (matching the frontend).
 * The frontend passes SMF amounts as plain integers (1 SMF = 1 unit), so
 * nftCostMin and nftCostBase must also be in raw units, not 1e18 wei.
 *
 * Usage: npx truffle exec scripts/setNftCostParams.js --network sepolia
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const SmartfolioERC20 = artifacts.require("SmartfolioERC20");

const PARAMS = {
  nftGrace:      '10',                    // first 11 NFTs pay floor cost only
  nftCostMin:    '1',                     // 1 SMF floor
  nftCostBase:   '5',                     // 5 SMF per log step
  nftRatioScale: '2000000000000000000',   // 2e18 — ratio multiplier scale (unit-independent)
};

module.exports = async function (callback) {
  try {
    const smfAddr = process.env.VITE_SMF_ADDRESS;
    const smf = await SmartfolioERC20.at(smfAddr);

    console.log("Setting NFT cost params on:", smfAddr);
    console.log("  nftGrace:     ", PARAMS.nftGrace);
    console.log("  nftCostMin:   ", PARAMS.nftCostMin, "SMF");
    console.log("  nftCostBase:  ", PARAMS.nftCostBase, "SMF per log step");
    console.log("  nftRatioScale:", PARAMS.nftRatioScale);

    const tx = await smf.setNftCostParams(
      PARAMS.nftGrace,
      PARAMS.nftCostMin,
      PARAMS.nftCostBase,
      PARAMS.nftRatioScale,
    );
    console.log("\n✓ setNftCostParams tx:", tx.tx);

    // Verify
    const { smfRequired, ethNeeded } = await smf.smfForNFT();
    console.log("\nsmfForNFT() →");
    console.log("  smfRequired:", smfRequired.toString(), "SMF units");
    console.log("  ethNeeded:  ", ethNeeded.toString(), "wei");

    callback();
  } catch (err) {
    callback(err);
  }
};
