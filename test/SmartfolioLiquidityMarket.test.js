/**
 * SmartfolioLiquidityMarket tests
 *
 * Mock topology:
 *   MockWETH  (token0 or token1 depending on address ordering)
 *   MockERC20 (tokenB — paired token in the pool)
 *   MockSwapRouter — 1:1 rate, pre-funded with both tokens
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

contract("SmartfolioLiquidityMarket", (accounts) => {
  const [owner, alice, keeper] = accounts;

  let sf, weth, tokenB, router, npm;

  beforeEach(async () => {
    // Deploy facets
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

    // Configure tiers and keeper
    await sf.setTiers(TIERS, { from: owner });
    await sf.setKeeper(keeper, { from: owner });

    // Deploy mocks
    weth   = await MockWETH.new();
    tokenB = await MockERC20.new("Token B", "TKNB");
    router = await MockSwapRouter.new();
    npm    = await MockNonfungiblePositionManager.new();

    await sf.setWETH(weth.address, { from: owner });
    await sf.setSwapRouter(router.address, { from: owner });
    await sf.setPositionManager(npm.address, { from: owner });

    // Pre-fund router with WETH and tokenB for 1:1 swaps
    await weth.deposit({ value: toWei("1") });
    await weth.transfer(router.address, toWei("1"));
    await tokenB.mint(router.address, toWei("1"));
  });

  // -------------------------------------------------------------------------
  // setLPConfig
  // -------------------------------------------------------------------------

  describe("setLPConfig", () => {
    it("stores LP config and emits event", async () => {
      const tx = await sf.setLPConfig(TOKEN_ID, {
        tokenB:   tokenB.address,
        poolFee:  POOL_FEE,
        tickLower: TICK_LOW,
        tickUpper: TICK_HIGH,
        swapFee:  SWAP_FEE,
      }, { from: owner });

      const cfg = await sf.lpConfig(TOKEN_ID);
      assert.equal(cfg.tokenB, tokenB.address);
      assert.equal(cfg.poolFee.toString(), String(POOL_FEE));

      assert.ok(tx.logs.some(l => l.event === "LPConfigSet"));
    });

    it("reverts for zero tokenB address", async () => {
      await expectRevert(
        sf.setLPConfig(TOKEN_ID, {
          tokenB: "0x0000000000000000000000000000000000000000",
          poolFee: POOL_FEE, tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
        }, { from: owner })
      );
    });

    it("reverts for invalid pool fee", async () => {
      await expectRevert(
        sf.setLPConfig(TOKEN_ID, {
          tokenB: tokenB.address,
          poolFee: 1234, tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
        }, { from: owner })
      );
    });

    it("reverts when tickLower >= tickUpper", async () => {
      await expectRevert(
        sf.setLPConfig(TOKEN_ID, {
          tokenB: tokenB.address,
          poolFee: POOL_FEE, tickLower: 0, tickUpper: 0, swapFee: SWAP_FEE,
        }, { from: owner })
      );
    });

    it("reverts when LP is already active", async () => {
      await sf.setLPConfig(TOKEN_ID, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });

      // Mint tokens so there is a reserve
      const cost = await sf.mintCost(10);
      await sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: cost });

      await sf.deployLP(TOKEN_ID, cost.div(new BN(2)), 0, 0, 0, { from: keeper });

      await expectRevert(
        sf.setLPConfig(TOKEN_ID, {
          tokenB: tokenB.address, poolFee: POOL_FEE,
          tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
        }, { from: owner })
      );
    });
  });

  // -------------------------------------------------------------------------
  // deployLP
  // -------------------------------------------------------------------------

  describe("deployLP", () => {
    let mintCost;

    beforeEach(async () => {
      await sf.setLPConfig(TOKEN_ID, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });

      // Mint 10 tokens → builds reserve
      mintCost = await sf.mintCost(10);
      await sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: mintCost });
    });

    it("deploys LP position and marks lpActive", async () => {
      const halfWeth = mintCost.div(new BN(2));
      await sf.deployLP(TOKEN_ID, halfWeth, 0, 0, 0, { from: keeper });

      const info = await sf.getLPInfo(TOKEN_ID);
      assert.ok(info.active, "lpActive should be true");
      assert.ok(new BN(info.liquidity).gt(new BN(0)), "liquidity should be > 0");
      assert.ok(new BN(info.positionId).gt(new BN(0)), "positionId should be set");
    });

    it("emits LPDeployed event", async () => {
      const halfWeth = mintCost.div(new BN(2));
      const tx = await sf.deployLP(TOKEN_ID, halfWeth, 0, 0, 0, { from: keeper });
      assert.ok(tx.logs.some(l => l.event === "LPDeployed"), "should emit LPDeployed");
    });

    it("clears reserve after deployment", async () => {
      const halfWeth = mintCost.div(new BN(2));
      await sf.deployLP(TOKEN_ID, halfWeth, 0, 0, 0, { from: keeper });

      // reserve[id] should be 0 (or small if there was unused WETH returned)
      const info = await sf.getLPInfo(TOKEN_ID);
      // deployedEth + reserve = original cost
      const total = new BN(info.deployedEth).add(new BN(info.reserve));
      assert.equal(total.toString(), mintCost.toString(), "deployedEth + reserve should equal original mint cost");
    });

    it("reverts if position manager not set", async () => {
      // Deploy fresh proxy without position manager
      const treasury2     = await SmartfolioTreasury.new();
      const market2       = await SmartfolioMarket.new();
      const creditMarket2 = await SmartfolioCreditMarket.new();
      const liqMarket2    = await SmartfolioLiquidityMarket.new();
      const sf2 = await deployProxy(Smartfolio, [owner, treasury2.address, market2.address, creditMarket2.address], { kind: "uups" });
      await sf2.setLiquidityMarketFacet(liqMarket2.address, { from: owner });
      await sf2.setTiers(TIERS, { from: owner });
      await sf2.setKeeper(keeper, { from: owner });
      await sf2.setWETH(weth.address, { from: owner });
      await sf2.setSwapRouter(router.address, { from: owner });
      // No positionManager set
      await sf2.setLPConfig(TOKEN_ID, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });
      const cost2 = await sf2.mintCost(5);
      await sf2.mint(alice, TOKEN_ID, 5, "0x", { from: alice, value: cost2 });

      await expectRevert(sf2.deployLP(TOKEN_ID, 0, 0, 0, 0, { from: keeper }));
    });

    it("reverts if already LP active", async () => {
      await sf.deployLP(TOKEN_ID, mintCost.div(new BN(2)), 0, 0, 0, { from: keeper });
      await expectRevert(
        sf.deployLP(TOKEN_ID, 0, 0, 0, 0, { from: keeper })
      );
    });

    it("reverts if not keeper", async () => {
      await expectRevert(
        sf.deployLP(TOKEN_ID, 0, 0, 0, 0, { from: alice })
      );
    });

    it("reverts if no reserve", async () => {
      // Burn all tokens first
      // Note: burn is blocked when LP not yet active; create fresh ID without LP config
      const TOKEN_ID2 = 2;
      await sf.setLPConfig(TOKEN_ID2, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });
      // No mints on TOKEN_ID2 → reserve is 0
      await expectRevert(
        sf.deployLP(TOKEN_ID2, 0, 0, 0, 0, { from: keeper })
      );
    });
  });

  // -------------------------------------------------------------------------
  // collectFees
  // -------------------------------------------------------------------------

  describe("collectFees", () => {
    let posId;

    beforeEach(async () => {
      await sf.setLPConfig(TOKEN_ID, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });
      const cost = await sf.mintCost(10);
      await sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: cost });
      await sf.deployLP(TOKEN_ID, cost.div(new BN(2)), 0, 0, 0, { from: keeper });

      const info = await sf.getLPInfo(TOKEN_ID);
      posId = info.positionId;
    });

    it("collects fees and adds to reserve", async () => {
      const fee0 = toWei("0.01"); // WETH or tokenB fees
      const fee1 = toWei("0.01");

      // Inject fees into the mock position — first fund npm with tokens
      const wethIsToken0 = await sf.lpWethIsToken0(TOKEN_ID);
      if (wethIsToken0) {
        await weth.deposit({ value: fee0 });
        await weth.transfer(npm.address, fee0);
        await tokenB.mint(npm.address, fee1);
      } else {
        await tokenB.mint(npm.address, fee0);
        await weth.deposit({ value: fee1 });
        await weth.transfer(npm.address, fee1);
      }
      await npm.addFees(posId, fee0, fee1);

      // Also pre-fund router with WETH to cover tokenB→WETH swap
      await weth.deposit({ value: toWei("1") });
      await weth.transfer(router.address, toWei("1"));

      const reserveBefore = await sf.reserve(TOKEN_ID);
      const tx = await sf.collectFees(TOKEN_ID, { from: keeper });

      const reserveAfter = await sf.reserve(TOKEN_ID);
      assert.ok(
        new BN(reserveAfter).gt(new BN(reserveBefore)),
        "reserve should increase after fee collection"
      );
      assert.ok(tx.logs.some(l => l.event === "LPFeeCollected"), "should emit LPFeeCollected");
    });

    it("reverts if LP not active", async () => {
      // Use a fresh token ID with no LP
      await expectRevert(sf.collectFees(999, { from: keeper }));
    });

    it("reverts if not keeper", async () => {
      await expectRevert(sf.collectFees(TOKEN_ID, { from: alice }));
    });
  });

  // -------------------------------------------------------------------------
  // divestLP
  // -------------------------------------------------------------------------

  describe("divestLP", () => {
    beforeEach(async () => {
      await sf.setLPConfig(TOKEN_ID, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });
      const cost = await sf.mintCost(10);
      await sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: cost });
      await sf.deployLP(TOKEN_ID, cost.div(new BN(2)), 0, 0, 0, { from: keeper });
    });

    it("burns tokens and returns ETH to user", async () => {
      const tx = await sf.divestLP(TOKEN_ID, 5, 0, { from: alice });

      assert.ok(tx.logs.some(l => l.event === "LPDivested"), "should emit LPDivested");
      const event = tx.logs.find(l => l.event === "LPDivested");
      assert.ok(new BN(event.args.ethReceived).gt(new BN(0)), "ethReceived should be > 0");

      const erc1155Bal = await sf.balanceOf(alice, TOKEN_ID);
      assert.equal(erc1155Bal.toString(), "5", "alice should have 5 tokens left");
    });

    it("last divest clears lpActive", async () => {
      await sf.divestLP(TOKEN_ID, 10, 0, { from: alice });

      const info = await sf.getLPInfo(TOKEN_ID);
      assert.ok(!info.active, "lpActive should be false after full exit");
    });

    it("reverts for zero amount", async () => {
      await expectRevert(sf.divestLP(TOKEN_ID, 0, 0, { from: alice }));
    });

    it("reverts if insufficient balance", async () => {
      await expectRevert(sf.divestLP(TOKEN_ID, 100, 0, { from: alice }));
    });

    it("reverts when minEthOut not met", async () => {
      await expectRevert(
        sf.divestLP(TOKEN_ID, 5, toWei("999"), { from: alice })
      );
    });

    it("reverts if LP not active", async () => {
      await expectRevert(sf.divestLP(999, 1, 0, { from: alice }));
    });

    it("updates globalTotalSupply", async () => {
      const before = await sf.globalTotalSupply();
      await sf.divestLP(TOKEN_ID, 5, 0, { from: alice });
      const after = await sf.globalTotalSupply();
      assert.equal(
        new BN(before).sub(new BN(after)).toString(),
        "5",
        "globalTotalSupply should decrease by divested amount"
      );
    });
  });

  // -------------------------------------------------------------------------
  // burn guard
  // -------------------------------------------------------------------------

  describe("burn guard for LP tokens", () => {
    it("reverts burn when LP is active", async () => {
      await sf.setLPConfig(TOKEN_ID, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });
      const cost = await sf.mintCost(5);
      await sf.mint(alice, TOKEN_ID, 5, "0x", { from: alice, value: cost });
      await sf.deployLP(TOKEN_ID, cost.div(new BN(2)), 0, 0, 0, { from: keeper });

      await expectRevert(sf.burn(TOKEN_ID, 1, { from: alice }));
    });
  });

  // -------------------------------------------------------------------------
  // setPortfolioConfig guard
  // -------------------------------------------------------------------------

  describe("setPortfolioConfig guard", () => {
    it("reverts setPortfolioConfig when LP is active", async () => {
      await sf.setLPConfig(TOKEN_ID, {
        tokenB: tokenB.address, poolFee: POOL_FEE,
        tickLower: TICK_LOW, tickUpper: TICK_HIGH, swapFee: SWAP_FEE,
      }, { from: owner });
      const cost = await sf.mintCost(5);
      await sf.mint(alice, TOKEN_ID, 5, "0x", { from: alice, value: cost });
      await sf.deployLP(TOKEN_ID, cost.div(new BN(2)), 0, 0, 0, { from: keeper });

      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, [
          { token: tokenB.address, weightBps: 10000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" }
        ], { from: owner })
      );
    });
  });
});
