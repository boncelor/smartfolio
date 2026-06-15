const Smartfolio = artifacts.require("Smartfolio");
const PROXY_ADDRESS = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

module.exports = async function (callback) {
  try {
    const proxy = await Smartfolio.at(PROXY_ADDRESS);
    const paused = await proxy.paused();
    console.log("Paused:", paused);
    if (paused) {
      const tx = await proxy.unpause();
      console.log("Unpaused. tx:", tx.tx);
    } else {
      console.log("Already unpaused.");
    }
    callback();
  } catch (err) {
    callback(err);
  }
};
