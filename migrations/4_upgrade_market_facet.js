const SmartfolioMarket = artifacts.require("SmartfolioMarket");
const Smartfolio       = artifacts.require("Smartfolio");

const PROXY_ADDRESS = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

module.exports = async function (deployer) {
  // 1. Deploy new market facet
  await deployer.deploy(SmartfolioMarket);
  const newMarket = await SmartfolioMarket.deployed();
  console.log("New SmartfolioMarket deployed:", newMarket.address);

  // 2. Connect to proxy
  const proxy = await Smartfolio.at(PROXY_ADDRESS);

  // 3. Pause, swap facet, unpause
  await proxy.pause();
  console.log("Proxy paused");

  await proxy.setMarketFacet(newMarket.address);
  console.log("Market facet updated to:", newMarket.address);

  await proxy.unpause();
  console.log("Proxy unpaused — done.");
};
