const Smartfolio = artifacts.require("Smartfolio");
const toWei = (n) => web3.utils.toWei(String(n), "ether");

const PROXY = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

module.exports = async function (callback) {
  try {
    const sf = await Smartfolio.at(PROXY);
    const [owner] = await web3.eth.getAccounts();
    console.log("Owner:", owner);

    await sf.setTiers([
      { threshold: 100,   pricePerToken: toWei("0.001") },
      { threshold: 1000,  pricePerToken: toWei("0.01")  },
      { threshold: 10000, pricePerToken: toWei("0.1")   },
      { threshold: 0,     pricePerToken: toWei("1.0")   },
    ], { from: owner });
    console.log("✓ Tiers set");

    callback();
  } catch (e) {
    callback(e);
  }
};
