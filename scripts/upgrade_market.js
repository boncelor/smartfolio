require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const Smartfolio       = artifacts.require("Smartfolio");
const SmartfolioMarket = artifacts.require("SmartfolioMarket");

const PROXY = process.env.VITE_CONTRACT_ADDRESS;

module.exports = async function (callback) {
  try {
    const [owner] = await web3.eth.getAccounts();
    console.log("Upgrading market from:", owner);
    console.log("Proxy:                ", PROXY);

    const proxy = await Smartfolio.at(PROXY);

    // 1. New proxy implementation (setPortfolioConfig no longer gated on portfolioActive)
    const newImpl = await Smartfolio.new({ from: owner });
    console.log("✓ New Smartfolio implementation:", newImpl.address);
    await proxy.upgradeToAndCall(newImpl.address, "0x", { from: owner });
    console.log("✓ Proxy upgraded");

    // 2. New market facet (deploy/rebalance/divest no longer gated on portfolioActive)
    const market = await SmartfolioMarket.new({ from: owner });
    console.log("✓ New SmartfolioMarket:", market.address);

    await proxy.pause({ from: owner });
    console.log("✓ Proxy paused");

    await proxy.setMarketFacet(market.address, { from: owner });
    console.log("✓ Market facet updated");

    await proxy.unpause({ from: owner });
    console.log("✓ Proxy unpaused");

    console.log("\nDone — market upgraded. portfolioActive no longer gates setPortfolioConfig, deploy, rebalance, or divest.");
    callback();
  } catch (e) {
    callback(e);
  }
};
