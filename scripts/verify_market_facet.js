const Smartfolio = artifacts.require("Smartfolio");
const PROXY_ADDRESS = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";
const EXPECTED_MARKET = "0xf4a67138abdF2cBB32c9194acE076533876e003D";

module.exports = async function (callback) {
  try {
    const proxy = await Smartfolio.at(PROXY_ADDRESS);
    const paused     = await proxy.paused();
    const marketFacet = await proxy.marketFacet();
    console.log("Paused:       ", paused);
    console.log("Market facet: ", marketFacet);
    console.log("Expected:     ", EXPECTED_MARKET);
    console.log("Match:        ", marketFacet.toLowerCase() === EXPECTED_MARKET.toLowerCase());
    callback();
  } catch (err) {
    callback(err);
  }
};
