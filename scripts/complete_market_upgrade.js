const Smartfolio = artifacts.require("Smartfolio");

const PROXY_ADDRESS      = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";
const NEW_MARKET_ADDRESS = "0xf4a67138abdF2cBB32c9194acE076533876e003D";

module.exports = async function (callback) {
  try {
    const proxy = await Smartfolio.at(PROXY_ADDRESS);

    // Check if paused
    const paused = await proxy.paused();
    console.log("Proxy paused:", paused);

    if (!paused) {
      console.log("Pausing proxy...");
      await proxy.pause();
      console.log("Paused.");
    }

    console.log("Setting market facet to:", NEW_MARKET_ADDRESS);
    await proxy.setMarketFacet(NEW_MARKET_ADDRESS);
    console.log("Market facet set.");

    console.log("Unpausing proxy...");
    await proxy.unpause();
    console.log("Done — proxy unpaused.");

    callback();
  } catch (err) {
    callback(err);
  }
};
