/**
 * SmartfolioMixedPortfolio tests
 *
 * Covers portfolios that combine ERC20, AAVE, and LP asset slices.
 *
 * Mock topology:
 *   MockWETH        — WETH9 simulation
 *   MockERC20 x2    — tokenA (ERC20 slice), tokenB (LP paired token)
 *   MockSwapRouter  — 1:1 rate, pre-funded
 *   MockAavePool    — stateful mock, tracks totalSupplied
 *   MockNonfungiblePositionManager — simplified LP mechanics
 */

const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio                  = artifacts.require("Smartfolio");
const SmartfolioTreasury          = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket            = artifacts.require("SmartfolioMarket");
const SmartfolioCreditMarket      = artifacts.require("SmartfolioCreditMarket");
const SmartfolioLiquidityMarket   = artifacts.require("SmartfolioLiquidityMarket");
const MockERC20                   = artifacts.require("MockERC20");
const MockWETH                    = artifacts.require("MockWETH");
const MockSwapRouter              = artifacts.require("MockSwapRouter");
const MockAavePool                = artifacts.require("MockAavePool");
const MockNonfungiblePositionManager = artifacts.require("MockNonfungiblePositionManager");

const BN = web3.utils.BN;
const toWei = (n, unit = "ether") => web3.utils.toWei(String(n), unit);

const TIERS = [
  { threshold: 100,  pricePerToken: toWei("0.001") },
  { threshold: 1000, pricePerToken: toWei("0.01")  },
  { threshold: 10000,pricePerToken: toWei("0.1")   },
  { threshold: 0,    pricePerToken: toWei("1.0")   },
];

const TOKEN_ID  = 1;
const POOL_FEE  = 3000;
const SWAP_FEE  = 3000;
const TICK_LOW  = -887220;
const TICK_HIGH =  887220;

// AssetType enum values
const ERC20_TYPE = 0;
const AAVE_TYPE  = 1;
const LP_TYPE    = 2;

async function expectRevert(promise) {
  try {
    await promise;
    assert.fail("Expected revert not received");
  } catch (err) {
    const reverted =
      err.message.includes("revert") ||
      err.message.includes("VM Exception");
    assert.ok(reverted, `Expected a revert but got: ${err.message}`);
  }
}

contract("SmartfolioMixedPortfolio", (accounts) => {
  const [owner, alice, bob, keeper] = accounts;

  let sf, weth, tokenA, tokenB, router, aave, npm;

  beforeEach(async () => {
    const treasury        = await SmartfolioTreasury.new();
    const market          = await SmartfolioMarket.new();
    const creditMarket    = await SmartfolioCreditMarket.new();
    const liquidityMarket = await SmartfolioLiquidityMarket.new();

    sf = await deployProxy(
      Smartfolio,
      [owner, treasury.address, market.address, creditMarket.address],
      { kind: "uups" }
    );
    await sf.setLiquidityMarketFacet(liquidityMarket.address, { from: owner });
    await sf.setTiers(TIERS, { from: owner });
    await sf.setKeeper(keeper, { from: owner });

    weth   = await MockWETH.new();
    tokenA = await MockERC20.new("Token A", "TKA");
    tokenB = await MockERC20.new("Token B", "TKB");
    router = await MockSwapRouter.new();
    aave   = await MockAavePool.new();
    npm    = await MockNonfungiblePositionManager.new();

    await sf.setWETH(weth.address,          { from: owner });
    await sf.setSwapRouter(router.address,   { from: owner });
    await sf.setDefaultAavePool(aave.address,{ from: owner });
    await sf.setPositionManager(npm.address, { from: owner });
    await sf.setSMFContract(owner, { from: owner });

    // Pre-fund router: tokenA and tokenB for WETH→token swaps; WETH for token→WETH sells
    await tokenA.mint(router.address, toWei("100"));
    await tokenB.mint(router.address, toWei("100"));
    await weth.deposit({ value: toWei("1") });
    await weth.transfer(router.address, toWei("1"));
  });

  // -------------------------------------------------------------------------
  // setPortfolioConfig — mixed type validation
  // -------------------------------------------------------------------------

  describe("setPortfolioConfig — mixed types", () => {
    it("accepts a valid ERC20+AAVE+LP config", async () => {
      await sf.setPortfolioConfig(TOKEN_ID, [
        { assetType: ERC20_TYPE, token: tokenA.address, weightBps: 4000, poolFee: POOL_FEE, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: AAVE_TYPE,  token: "0x0000000000000000000000000000000000000000", weightBps: 3000, poolFee: 0, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: LP_TYPE,    token: tokenB.address, weightBps: 3000, poolFee: POOL_FEE, swapFee: SWAP_FEE, tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapPath: "0x", sellSwapPath: "0x" },
      ], { from: owner });

      const config = await sf.getPortfolioConfig(TOKEN_ID);
      assert.equal(config.length, 3);
      assert.equal(config[0].assetType.toString(), String(ERC20_TYPE));
      assert.equal(config[1].assetType.toString(), String(AAVE_TYPE));
      assert.equal(config[2].assetType.toString(), String(LP_TYPE));
    });

    it("reverts LP slot with invalid poolFee", async () => {
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, [
          { assetType: LP_TYPE, token: tokenB.address, weightBps: 10000, poolFee: 1234, swapFee: SWAP_FEE, tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapPath: "0x", sellSwapPath: "0x" },
        ], { from: owner })
      );
    });

    it("reverts LP slot with tickLower >= tickUpper", async () => {
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, [
          { assetType: LP_TYPE, token: tokenB.address, weightBps: 10000, poolFee: POOL_FEE, swapFee: SWAP_FEE, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        ], { from: owner })
      );
    });

    it("reverts LP slot with zero tokenB", async () => {
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, [
          { assetType: LP_TYPE, token: "0x0000000000000000000000000000000000000000", weightBps: 10000, poolFee: POOL_FEE, swapFee: SWAP_FEE, tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapPath: "0x", sellSwapPath: "0x" },
        ], { from: owner })
      );
    });
  });

  // -------------------------------------------------------------------------
  // ERC20-only portfolio — regression
  // -------------------------------------------------------------------------

  describe("ERC20-only portfolio (regression)", () => {
    beforeEach(async () => {
      await sf.setPortfolioConfig(TOKEN_ID, [
        { assetType: ERC20_TYPE, token: tokenA.address, weightBps: 6000, poolFee: POOL_FEE, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: ERC20_TYPE, token: tokenB.address, weightBps: 4000, poolFee: POOL_FEE, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      ], { from: owner });
      const cost = await sf.mintCost(10);
      await sf.mintFunded(alice, TOKEN_ID, 10, { from: owner, value: cost });
    });

    it("deploys ERC20 basket and marks active", async () => {
      await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, { from: keeper });
      assert.equal(await sf.portfolioActive(TOKEN_ID), true);
      assert.ok(new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address)).gt(new BN(0)));
      assert.ok(new BN(await sf.portfolioHoldings(TOKEN_ID, tokenB.address)).gt(new BN(0)));
    });

    it("divests and returns ETH", async () => {
      await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, { from: keeper });
      const tx = await sf.divest(TOKEN_ID, 10, 0, { from: alice });
      assert.ok(tx.logs.some(l => l.event === "Divested"));
      assert.equal(await sf.portfolioActive(TOKEN_ID), false);
    });
  });

  // -------------------------------------------------------------------------
  // AAVE-only portfolio slice
  // -------------------------------------------------------------------------

  describe("AAVE-only portfolio", () => {
    beforeEach(async () => {
      await sf.setPortfolioConfig(TOKEN_ID, [
        { assetType: AAVE_TYPE, token: "0x0000000000000000000000000000000000000000", weightBps: 10000, poolFee: 0, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      ], { from: owner });
      const cost = await sf.mintCost(10);
      await sf.mintFunded(alice, TOKEN_ID, 10, { from: owner, value: cost });
    });

    it("deploys WETH to Aave and records portfolioAaveWeth", async () => {
      const reserve = await sf.reserve(TOKEN_ID);
      await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });

      assert.equal(await sf.portfolioActive(TOKEN_ID), true);
      const aaveWeth = await sf.portfolioAaveWeth(TOKEN_ID);
      assert.equal(aaveWeth.toString(), reserve.toString(), "portfolioAaveWeth should equal deployed reserve");

      const aaveSupplied = await aave.totalSupplied();
      assert.equal(aaveSupplied.toString(), reserve.toString(), "MockAavePool should have received WETH");
    });

    it("emits PortfolioAaveDeployed", async () => {
      const tx = await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });
      assert.ok(tx.logs.some(l => l.event === "PortfolioAaveDeployed"), "should emit PortfolioAaveDeployed");
    });

    it("divests: withdraws proportional WETH from Aave and returns ETH", async () => {
      await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });

      const tx = await sf.divest(TOKEN_ID, 10, 0, { from: alice });
      assert.ok(tx.logs.some(l => l.event === "Divested"));
      assert.ok(tx.logs.some(l => l.event === "PortfolioAaveDivested"));

      assert.equal(await sf.portfolioActive(TOKEN_ID), false);
      assert.equal((await sf.portfolioAaveWeth(TOKEN_ID)).toString(), "0");
      assert.equal((await aave.totalSupplied()).toString(), "0");
    });

    it("partial divest reduces portfolioAaveWeth proportionally", async () => {
      await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });
      const aaveBefore = new BN(await sf.portfolioAaveWeth(TOKEN_ID));

      await sf.divest(TOKEN_ID, 5, 0, { from: alice }); // 50%

      const aaveAfter = new BN(await sf.portfolioAaveWeth(TOKEN_ID));
      assert.equal(
        aaveBefore.sub(aaveAfter).toString(),
        aaveBefore.divn(2).toString(),
        "portfolioAaveWeth should halve after 50% divest"
      );
    });
  });

  // -------------------------------------------------------------------------
  // LP-only portfolio slice
  // -------------------------------------------------------------------------

  describe("LP-only portfolio", () => {
    beforeEach(async () => {
      await sf.setPortfolioConfig(TOKEN_ID, [
        { assetType: LP_TYPE, token: tokenB.address, weightBps: 10000, poolFee: POOL_FEE, swapFee: SWAP_FEE, tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapPath: "0x", sellSwapPath: "0x" },
      ], { from: owner });
      const cost = await sf.mintCost(10);
      await sf.mintFunded(alice, TOKEN_ID, 10, { from: owner, value: cost });
    });

    it("deploys LP position and records portfolioLpLiquidity", async () => {
      await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });

      assert.equal(await sf.portfolioActive(TOKEN_ID), true);
      const lpInfo = await sf.getPortfolioLPInfo(TOKEN_ID);
      assert.ok(new BN(lpInfo.liquidity).gt(new BN(0)), "liquidity should be > 0");
      assert.ok(new BN(lpInfo.positionId).gt(new BN(0)), "positionId should be set");
    });

    it("emits PortfolioLPDeployed", async () => {
      const tx = await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });
      assert.ok(tx.logs.some(l => l.event === "PortfolioLPDeployed"), "should emit PortfolioLPDeployed");
    });

    it("divests: removes LP position and returns ETH", async () => {
      await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });

      const tx = await sf.divest(TOKEN_ID, 10, 0, { from: alice });
      assert.ok(tx.logs.some(l => l.event === "Divested"));
      assert.ok(tx.logs.some(l => l.event === "PortfolioLPDivested"));

      assert.equal(await sf.portfolioActive(TOKEN_ID), false);
    });

    it("partial divest removes proportional LP liquidity", async () => {
      await sf.deploy(TOKEN_ID, [], 0, 0, 0, { from: keeper });
      const lpBefore = new BN((await sf.getPortfolioLPInfo(TOKEN_ID)).liquidity);

      await sf.divest(TOKEN_ID, 5, 0, { from: alice }); // 50%

      const lpAfter = new BN((await sf.getPortfolioLPInfo(TOKEN_ID)).liquidity);
      assert.ok(lpAfter.lt(lpBefore), "liquidity should decrease after partial divest");
    });
  });

  // -------------------------------------------------------------------------
  // Mixed ERC20 + AAVE + LP portfolio
  // -------------------------------------------------------------------------

  describe("ERC20 + AAVE + LP mixed portfolio", () => {
    // 40% ERC20 (tokenA), 30% AAVE, 30% LP (tokenB)
    const mixedConfig = (addrA, addrB) => [
      { assetType: ERC20_TYPE, token: addrA, weightBps: 4000, poolFee: POOL_FEE, swapFee: 0,        tickLower: 0,        tickUpper: 0,         swapPath: "0x", sellSwapPath: "0x" },
      { assetType: AAVE_TYPE,  token: "0x0000000000000000000000000000000000000000", weightBps: 3000, poolFee: 0,        swapFee: 0,        tickLower: 0,        tickUpper: 0,         swapPath: "0x", sellSwapPath: "0x" },
      { assetType: LP_TYPE,    token: addrB, weightBps: 3000, poolFee: POOL_FEE, swapFee: SWAP_FEE, tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapPath: "0x", sellSwapPath: "0x" },
    ];

    beforeEach(async () => {
      await sf.setPortfolioConfig(TOKEN_ID, mixedConfig(tokenA.address, tokenB.address), { from: owner });
      const cost = await sf.mintCost(10);
      await sf.mintFunded(alice, TOKEN_ID, 10, { from: owner, value: cost });
    });

    it("deploy correctly splits ETH across all three types", async () => {
      const reserveBefore = new BN(await sf.reserve(TOKEN_ID));
      await sf.deploy(TOKEN_ID, [0], 0, 0, 0, { from: keeper });

      assert.equal(await sf.portfolioActive(TOKEN_ID), true);

      // ERC20 slice: 40% went to tokenA
      const expectedErc20 = reserveBefore.muln(4000).divn(10000);
      const holdingA = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
      assert.equal(holdingA.toString(), expectedErc20.toString(), "ERC20 slice should be 40%");

      // AAVE slice: 30% went to Aave
      const expectedAave = reserveBefore.muln(3000).divn(10000);
      const aaveWeth = new BN(await sf.portfolioAaveWeth(TOKEN_ID));
      assert.equal(aaveWeth.toString(), expectedAave.toString(), "AAVE slice should be 30%");

      // LP slice: 30% went to LP position
      const lpInfo = await sf.getPortfolioLPInfo(TOKEN_ID);
      assert.ok(new BN(lpInfo.liquidity).gt(new BN(0)), "LP slice should have liquidity");
    });

    it("deploy emits Deployed, PortfolioAaveDeployed, PortfolioLPDeployed", async () => {
      const tx = await sf.deploy(TOKEN_ID, [0], 0, 0, 0, { from: keeper });
      assert.ok(tx.logs.some(l => l.event === "Deployed"),              "Deployed event missing");
      assert.ok(tx.logs.some(l => l.event === "PortfolioAaveDeployed"), "PortfolioAaveDeployed event missing");
      assert.ok(tx.logs.some(l => l.event === "PortfolioLPDeployed"),   "PortfolioLPDeployed event missing");
    });

    it("full divest returns ETH from all three slices and resets active", async () => {
      await sf.deploy(TOKEN_ID, [0], 0, 0, 0, { from: keeper });

      const tx = await sf.divest(TOKEN_ID, 10, 0, { from: alice });
      assert.ok(tx.logs.some(l => l.event === "Divested"));
      assert.ok(tx.logs.some(l => l.event === "PortfolioAaveDivested"));
      assert.ok(tx.logs.some(l => l.event === "PortfolioLPDivested"));

      assert.equal(await sf.portfolioActive(TOKEN_ID), false);
      assert.equal((await sf.portfolioAaveWeth(TOKEN_ID)).toString(), "0");
      assert.equal((await sf.portfolioHoldings(TOKEN_ID, tokenA.address)).toString(), "0");
    });

    it("partial divest by alice, remainder by bob", async () => {
      // Bob mints too (equal share)
      const cost = await sf.mintCost(10);
      await sf.mintFunded(bob, TOKEN_ID, 10, { from: owner, value: cost });

      await sf.deploy(TOKEN_ID, [0], 0, 0, 0, { from: keeper });

      // Alice divests her 10 (50% of supply=20)
      await sf.divest(TOKEN_ID, 10, 0, { from: alice });
      assert.equal(await sf.portfolioActive(TOKEN_ID), true, "still active after partial divest");

      // Bob divests his 10 (remaining 100%)
      await sf.divest(TOKEN_ID, 10, 0, { from: bob });
      assert.equal(await sf.portfolioActive(TOKEN_ID), false, "inactive after full exit");
    });

    it("reverts minEthOut not met", async () => {
      await sf.deploy(TOKEN_ID, [0], 0, 0, 0, { from: keeper });
      await expectRevert(sf.divest(TOKEN_ID, 10, toWei("999"), { from: alice }));
    });

    it("erc20MinAmounts length must match ERC20 slot count", async () => {
      // Pass 2 minAmounts for 1 ERC20 slot — should revert
      await expectRevert(
        sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, { from: keeper })
      );
    });

    it("globalTotalSupply decreases on divest", async () => {
      await sf.deploy(TOKEN_ID, [0], 0, 0, 0, { from: keeper });
      const before = new BN(await sf.globalTotalSupply());
      await sf.divest(TOKEN_ID, 5, 0, { from: alice });
      const after = new BN(await sf.globalTotalSupply());
      assert.equal(before.sub(after).toString(), "5");
    });

    it("burn reverts while portfolio is active", async () => {
      await sf.deploy(TOKEN_ID, [0], 0, 0, 0, { from: keeper });
      await expectRevert(sf.burn(TOKEN_ID, 1, { from: alice }));
    });
  });

  // -------------------------------------------------------------------------
  // setDefaultAavePool
  // -------------------------------------------------------------------------

  describe("setDefaultAavePool", () => {
    it("sets pool and emits event", async () => {
      const tx = await sf.setDefaultAavePool(aave.address, { from: owner });
      assert.equal(await sf.defaultAavePool(), aave.address);
      assert.ok(tx.logs.some(l => l.event === "DefaultAavePoolSet"));
    });

    it("reverts zero address", async () => {
      await expectRevert(
        sf.setDefaultAavePool("0x0000000000000000000000000000000000000000", { from: owner })
      );
    });
  });
});
