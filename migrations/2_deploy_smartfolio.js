const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio                  = artifacts.require("Smartfolio");
const SmartfolioTreasury          = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket            = artifacts.require("SmartfolioMarket");
const SmartfolioCreditMarket      = artifacts.require("SmartfolioCreditMarket");
const SmartfolioLiquidityMarket   = artifacts.require("SmartfolioLiquidityMarket");
const SmartfolioTokenFactory      = artifacts.require("SmartfolioTokenFactory");

module.exports = async function (deployer, network, accounts) {
  const initialOwner = accounts[0];

  await deployer.deploy(SmartfolioTreasury);
  await deployer.deploy(SmartfolioMarket);
  await deployer.deploy(SmartfolioCreditMarket);
  await deployer.deploy(SmartfolioLiquidityMarket);

  const treasury          = await SmartfolioTreasury.deployed();
  const market            = await SmartfolioMarket.deployed();
  const creditMarket      = await SmartfolioCreditMarket.deployed();
  const liquidityMarket   = await SmartfolioLiquidityMarket.deployed();

  const proxy = await deployProxy(
    Smartfolio,
    [initialOwner, treasury.address, market.address, creditMarket.address],
    { deployer, kind: "uups" }
  );

  // Wire up the liquidity market facet post-deploy (requires pause)
  await proxy.pause();
  await proxy.setLiquidityMarketFacet(liquidityMarket.address);
  await proxy.unpause();

  // Deploy the ERC20 wrapper factory
  const tokenFactory = await deployer.deploy(SmartfolioTokenFactory, proxy.address, initialOwner);

  console.log("Smartfolio deployed (UUPS proxy)");
  console.log("  TreasuryFacet:          ", treasury.address);
  console.log("  MarketFacet:            ", market.address);
  console.log("  CreditMarketFacet:      ", creditMarket.address);
  console.log("  LiquidityMarketFacet:   ", liquidityMarket.address);
  console.log("  TokenFactory:           ", tokenFactory.address);
};
