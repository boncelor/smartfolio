const SmartfolioERC20 = artifacts.require("SmartfolioERC20");

const PROXY = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

const TIERS = [
  { threshold: 100,   pricePerToken: web3.utils.toWei("0.001", "ether") },
  { threshold: 1000,  pricePerToken: web3.utils.toWei("0.01",  "ether") },
  { threshold: 10000, pricePerToken: web3.utils.toWei("0.1",   "ether") },
  { threshold: 0,     pricePerToken: web3.utils.toWei("1.0",   "ether") },
];

module.exports = async function (callback) {
  try {
    const [owner] = await web3.eth.getAccounts();
    console.log("Deploying from:", owner);

    const smf = await SmartfolioERC20.new(PROXY, owner, { from: owner });
    console.log("SmartfolioERC20 (SMF) deployed:", smf.address);

    await smf.setTiers(TIERS, { from: owner });
    console.log("✓ Tiers set");

    // Wire SMF contract into Smartfolio proxy
    const Smartfolio = artifacts.require("Smartfolio");
    const sf = await Smartfolio.at(PROXY);
    await sf.setSMFContract(smf.address, { from: owner });
    console.log("✓ SMF contract registered on Smartfolio proxy");

    console.log("\nSummary:");
    console.log("  SmartfolioERC20 (SMF):", smf.address);
    console.log("  Smartfolio proxy:     ", PROXY);

    callback();
  } catch (e) {
    callback(e);
  }
};
