const SmartfolioTokenFactory = artifacts.require("SmartfolioTokenFactory");

const PROXY = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

module.exports = async function (callback) {
  try {
    const [owner] = await web3.eth.getAccounts();
    console.log("Deploying from:", owner);

    const factory = await SmartfolioTokenFactory.new(PROXY, owner, { from: owner });
    console.log("TokenFactory deployed:", factory.address);

    callback();
  } catch (e) {
    callback(e);
  }
};
