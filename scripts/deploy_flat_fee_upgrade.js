/**
 * Deploy flat-fee SMF sell upgrade.
 *
 * 1. Deploy new SmartfolioERC20 (adds sellSMFForRebalance + nftSellFeeRate)
 * 2. Configure tiers + NFT cost params on new SMF
 * 3. Deploy new SmartfolioMarket (calls sellSMFForRebalance in rebalanceAll)
 * 4. Pause proxy → setMarketFacet(newMarket) → setSMFContract(newSMF) → unpause
 *
 * Run: npx truffle exec scripts/deploy_flat_fee_upgrade.js --network sepolia
 */
const Smartfolio        = artifacts.require("Smartfolio");
const SmartfolioERC20   = artifacts.require("SmartfolioERC20");
const SmartfolioMarket  = artifacts.require("SmartfolioMarket");

const PROXY_ADDRESS = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

// Tiers from current deployment — keep identical
// pricePerToken in wei (ETH per whole SMF token)
const TIERS = [
  { threshold: 100,   pricePerToken: "1000000000000000"    }, // 0.001  ETH up to 100  SMF
  { threshold: 1000,  pricePerToken: "10000000000000000"   }, // 0.01   ETH up to 1000 SMF
  { threshold: 10000, pricePerToken: "100000000000000000"  }, // 0.1    ETH up to 10k  SMF
  { threshold: 0,     pricePerToken: "1000000000000000000" }, // 1.0    ETH open-ended
];

module.exports = async function (callback) {
  try {
    const [owner] = await web3.eth.getAccounts();
    const proxy   = await Smartfolio.at(PROXY_ADDRESS);

    console.log("Owner:           ", owner);
    console.log("Proxy:           ", PROXY_ADDRESS);
    console.log("Current SMF:     ", await proxy.smfContract());
    console.log("Current market:  ", await proxy.marketFacet());

    // ── 1. Deploy new SmartfolioERC20 ────────────────────────────────────────
    console.log("\n[1/4] Deploying new SmartfolioERC20...");
    const newSMF = await SmartfolioERC20.new(PROXY_ADDRESS, owner, { from: owner });
    console.log("✓ New SMF:", newSMF.address);

    // ── 2. Configure tiers ────────────────────────────────────────────────────
    console.log("\n[2/4] Setting tiers on new SMF...");
    await newSMF.setTiers(TIERS, { from: owner });
    console.log("✓ Tiers set");

    // Verify tiers
    const tiers = await newSMF.getTiers();
    console.log("  Tier count:", tiers.length);
    for (const t of tiers) {
      console.log(`  threshold=${t.threshold} price=${t.pricePerToken}`);
    }

    // ── 3. Deploy new SmartfolioMarket ────────────────────────────────────────
    console.log("\n[3/4] Deploying new SmartfolioMarket...");
    const newMarket = await SmartfolioMarket.new({ from: owner });
    console.log("✓ New market facet:", newMarket.address);

    // ── 4. Swap facet + SMF contract on proxy ────────────────────────────────
    console.log("\n[4/4] Updating proxy...");
    await proxy.pause({ from: owner });
    console.log("✓ Proxy paused");

    await proxy.setMarketFacet(newMarket.address, { from: owner });
    console.log("✓ marketFacet →", newMarket.address);

    await proxy.setSMFContract(newSMF.address, { from: owner });
    console.log("✓ smfContract →", newSMF.address);

    await proxy.unpause({ from: owner });
    console.log("✓ Proxy unpaused");

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log("\n=== Done ===");
    console.log("New SmartfolioERC20:", newSMF.address);
    console.log("New SmartfolioMarket:", newMarket.address);
    console.log("\nUpdate frontend env:");
    console.log("  VITE_SMF_ADDRESS=" + newSMF.address);
    console.log("\nVerify:");
    console.log("  smfContract:", await proxy.smfContract());
    console.log("  marketFacet:", await proxy.marketFacet());
    console.log("  paused:     ", await proxy.paused());

    callback();
  } catch (e) {
    callback(e);
  }
};
