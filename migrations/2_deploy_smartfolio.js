const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio         = artifacts.require("Smartfolio");
const SmartfolioTreasury = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket   = artifacts.require("SmartfolioMarket");

module.exports = async function (deployer, network, accounts) {
  const initialOwner = accounts[0];

  await deployer.deploy(SmartfolioTreasury);
  await deployer.deploy(SmartfolioMarket);

  const treasury = await SmartfolioTreasury.deployed();
  const market   = await SmartfolioMarket.deployed();

  const proxy = await deployProxy(
    Smartfolio,
    [initialOwner, treasury.address, market.address],
    { deployer, kind: "uups" }
  );

  console.log("Smartfolio deployed (UUPS proxy)");
  console.log("  TreasuryFacet: ", treasury.address);
  console.log("  MarketFacet:   ", market.address);
  console.log("  Proxy:         ", proxy.address);
};
