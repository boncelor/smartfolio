const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio = artifacts.require("Smartfolio");

module.exports = async function (deployer, network, accounts) {
  const initialOwner = accounts[0];

  await deployProxy(Smartfolio, [initialOwner], {
    deployer,
    kind: "uups",
  });

  console.log("Smartfolio deployed (UUPS proxy)");
};
