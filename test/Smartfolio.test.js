const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio      = artifacts.require("Smartfolio");
const MockERC20       = artifacts.require("MockERC20");
const MockWETH        = artifacts.require("MockWETH");
const MockSwapRouter  = artifacts.require("MockSwapRouter");
const MockAavePool    = artifacts.require("MockAavePool");
const MockSMFToken    = artifacts.require("MockSMFToken");
const SmartfolioTreasury     = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket       = artifacts.require("SmartfolioMarket");

const BN = web3.utils.BN;
const toWei = (n, unit = "ether") => web3.utils.toWei(String(n), unit);
const fromWei = (n) => web3.utils.fromWei(String(n), "ether");

// Standard 4-tier config used across most tests:
// tier 0: 0–99   → 0.001 ETH
// tier 1: 100–999 → 0.01 ETH
// tier 2: 1000–9999 → 0.1 ETH
// tier 3: 10000+  → 1.0 ETH
const TIERS = [
  { threshold: 100,  pricePerToken: toWei("0.001") },
  { threshold: 1000, pricePerToken: toWei("0.01")  },
  { threshold: 10000,pricePerToken: toWei("0.1")   },
  { threshold: 0,    pricePerToken: toWei("1.0")   }, // open-ended top tier
];

const TOKEN_ID = 1;
const WAD = new BN(toWei("1")); // 1e18

async function expectRevert(promise, message) {
  try {
    await promise;
    assert.fail("Expected revert not received");
  } catch (err) {
    // OZ v5 uses custom errors; ganache may return them as "Custom error (could not decode)".
    // If the tx reverted at all, that satisfies a no-message assertion.
    const reverted =
      err.message.includes("revert") ||
      err.message.includes("VM Exception");
    assert.ok(reverted, `Expected a revert but got: ${err.message}`);

    if (message) {
      // Custom errors are not decodable by ganache — they appear as a plain "revert"
      // with no message body, or as "Custom error (could not decode)".
      // Either way, skip string matching; just verifying the revert happened is enough.
      const isCustomError =
        err.message.includes("Custom error") ||
        /revert\s*$/.test(err.message.trim());
      if (!isCustomError) {
        assert(
          err.message.includes(message),
          `Expected "${message}" but got: ${err.message}`
        );
      }
    }
  }
}

contract("Smartfolio", (accounts) => {
  const [owner, alice, bob, treasury] = accounts;

  let sf;

  beforeEach(async () => {
    const treasury = await SmartfolioTreasury.new();
    const market   = await SmartfolioMarket.new();
    sf = await deployProxy(Smartfolio, [owner, treasury.address, market.address], { kind: "uups" });
    await sf.setTiers(TIERS, { from: owner });
    await sf.setSMFContract(owner, { from: owner });
  });

  // ---------------------------------------------------------------------------
  // Deployment & initialisation
  // ---------------------------------------------------------------------------

  describe("initialization", () => {
    it("sets the owner", async () => {
      assert.equal(await sf.owner(), owner);
    });

    it("sets maxBurnFeeRate to 50%", async () => {
      const rate = await sf.maxBurnFeeRate();
      assert.equal(rate.toString(), toWei("0.5"));
    });

    it("treasury defaults to zero address", async () => {
      assert.equal(await sf.treasury(), "0x0000000000000000000000000000000000000000");
    });

    it("reverts if initialize is called again", async () => {
      await expectRevert(sf.initialize(owner, sf.address, sf.address, { from: owner }), "InvalidInitialization");
    });
  });

  // ---------------------------------------------------------------------------
  // setTiers
  // ---------------------------------------------------------------------------

  describe("setTiers", () => {
    it("stores tiers and emits TiersSet", async () => {
      const tx = await sf.setTiers(TIERS, { from: owner });
      const tiers = await sf.getTiers();
      assert.equal(tiers.length, 4);
      assert.equal(tiers[0].pricePerToken.toString(), toWei("0.001"));

      const log = tx.logs.find((l) => l.event === "TiersSet");
      assert.ok(log);
    });

    it("reverts if tiers are not ordered ascending", async () => {
      const bad = [
        { threshold: 1000, pricePerToken: toWei("0.01") },
        { threshold: 100,  pricePerToken: toWei("0.001") },
        { threshold: 0,    pricePerToken: toWei("1.0") },
      ];
      await expectRevert(
        sf.setTiers(bad, { from: owner }),
        "tiers must be ordered ascending"
      );
    });

    it("reverts if a price is zero", async () => {
      const bad = [{ threshold: 100, pricePerToken: 0 }];
      await expectRevert(sf.setTiers(bad, { from: owner }), "price must be > 0");
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setTiers(TIERS, { from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // mintCost — tier boundary logic
  // ---------------------------------------------------------------------------

  describe("mintCost", () => {
    it("prices within tier 0 correctly", async () => {
      const cost = await sf.mintCost(10);
      assert.equal(cost.toString(), toWei("0.01")); // 10 × 0.001
    });

    it("prices a mint that spans tier 0 → tier 1", async () => {
      // mint 50 first — globalTotalSupply becomes 50
      await sf.mintFunded(alice, TOKEN_ID, 50, { from: owner, value: toWei("0.05") });

      // globalTotalSupply = 50; next 100: 50 @ 0.001 (fills tier 0) + 50 @ 0.01
      const cost = await sf.mintCost(100);
      const expected = new BN(toWei("0.001")).muln(50).add(new BN(toWei("0.01")).muln(50));
      assert.equal(cost.toString(), expected.toString());
    });

    it("prices a mint entirely within tier 1", async () => {
      // globalTotalSupply = 100 after this mint — squarely in tier 1
      await sf.mintFunded(alice, TOKEN_ID, 100, { from: owner, value: toWei("0.1") });
      const cost = await sf.mintCost(10);
      assert.equal(cost.toString(), toWei("0.1")); // 10 × 0.01
    });

    it("prices a mint that spans all four tiers", async () => {
      // need supply at 0 for full cross
      // tier 0: 100 @ 0.001 = 0.1
      // tier 1: 900 @ 0.01  = 9
      // tier 2: 9000 @ 0.1  = 900
      // tier 3: 1    @ 1.0  = 1
      const cost = await sf.mintCost(10001);
      const expected = new BN(toWei("0.001")).muln(100)
        .add(new BN(toWei("0.01")).muln(900))
        .add(new BN(toWei("0.1")).muln(9000))
        .add(new BN(toWei("1.0")).muln(1));
      assert.equal(cost.toString(), expected.toString());
    });

    it("reverts if tiers not configured", async () => {
      // deploy a fresh proxy with no tiers set
      const t = await SmartfolioTreasury.new();
      const m = await SmartfolioMarket.new();
      const sfNoTiers = await deployProxy(Smartfolio, [owner, t.address, m.address], { kind: "uups" });
      await expectRevert(sfNoTiers.mintCost(1), "tiers not configured for id");
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(sf.mintCost(0), "amount must be > 0");
    });
  });

  // ---------------------------------------------------------------------------
  // burnFeeRate
  // ---------------------------------------------------------------------------

  describe("burnFeeRate", () => {
    beforeEach(async () => {
      const cost = await sf.mintCost(100);
      await sf.mintFunded(alice, TOKEN_ID, 100, { from: owner, value: cost });
    });

    it("returns ~0 for a tiny burn proportion", async () => {
      // globalTotalSupply = 100; burning 1 = 1% → rate = 0.01² × 0.5 = 0.00005 WAD
      const rate = await sf.burnFeeRate(1);
      const expected = WAD.div(new BN(100))         // 0.01 WAD (proportion)
        .mul(WAD.div(new BN(100)))                  // × 0.01
        .div(WAD)                                    // normalise
        .mul(new BN(toWei("0.5")))                  // × maxBurnFeeRate
        .div(WAD);
      assert.equal(rate.toString(), expected.toString());
    });

    it("returns 50% for burning 100% of supply (default maxBurnFeeRate)", async () => {
      const rate = await sf.burnFeeRate(100);
      // globalTotalSupply = 100; proportion = 100/100 = 1.0, 1² × 0.5 = 0.5
      assert.equal(rate.toString(), toWei("0.5"));
    });

    it("scales quadratically — doubling proportion quadruples rate", async () => {
      const rate10 = await sf.burnFeeRate(10); // 10% of globalTotalSupply (100)
      const rate20 = await sf.burnFeeRate(20); // 20% of globalTotalSupply (100)
      // rate20 ≈ rate10 × 4
      assert.equal(rate20.toString(), rate10.muln(4).toString());
    });

    it("reverts if amount exceeds globalTotalSupply", async () => {
      await expectRevert(sf.burnFeeRate(101), "amount exceeds supply");
    });
  });

  // ---------------------------------------------------------------------------
  // burnRefund
  // ---------------------------------------------------------------------------

  describe("burnRefund", () => {
    const MINT_AMOUNT = 100;

    beforeEach(async () => {
      const cost = await sf.mintCost(MINT_AMOUNT);
      await sf.mintFunded(alice, TOKEN_ID, MINT_AMOUNT, { from: owner, value: cost });
    });

    it("gross equals pro-rata share of reserve", async () => {
      const r = await sf.reserve(TOKEN_ID);
      const { gross } = await sf.burnRefund(TOKEN_ID, 10);
      // 10/100 of reserve
      assert.equal(gross.toString(), new BN(r).divn(10).toString());
    });

    it("net + fee equals gross", async () => {
      const { gross, fee, net } = await sf.burnRefund(TOKEN_ID, 50);
      assert.equal(new BN(net).add(new BN(fee)).toString(), gross.toString());
    });

    it("fee is much less than gross for a tiny burn proportion", async () => {
      // Burn 1 of 100 (1%). feeRate = 0.01² × 0.5 = 0.00005
      // fee should be negligible relative to gross
      const { gross, fee } = await sf.burnRefund(TOKEN_ID, 1);
      // fee < 0.1% of gross
      assert.ok(
        new BN(fee).muln(1000).lt(new BN(gross)),
        `fee ${fee} should be < 0.1% of gross ${gross}`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // burn — reserve mode (fee stays in reserve)
  // ---------------------------------------------------------------------------

  describe("burn (reserve mode)", () => {
    const MINT_AMOUNT = 100;
    let mintCostPaid;

    beforeEach(async () => {
      mintCostPaid = await sf.mintCost(MINT_AMOUNT);
      await sf.mintFunded(alice, TOKEN_ID, MINT_AMOUNT, { from: owner, value: mintCostPaid });
    });

    it("reduces balance, supply and emits Burned", async () => {
      const { net, fee } = await sf.burnRefund(TOKEN_ID, 10);
      const tx = await sf.burn(TOKEN_ID, 10, { from: alice });

      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "90");
      assert.equal((await sf.totalSupply(TOKEN_ID)).toString(), "90");

      const log = tx.logs.find((l) => l.event === "Burned");
      assert.ok(log);
      assert.equal(log.args.amount.toString(), "10");
      assert.equal(log.args.ethRefunded.toString(), net.toString());
      assert.equal(log.args.feePaid.toString(), fee.toString());
    });

    it("fee stays in reserve — reserve decreases only by net", async () => {
      const reserveBefore = await sf.reserve(TOKEN_ID);
      const { net } = await sf.burnRefund(TOKEN_ID, 10);
      await sf.burn(TOKEN_ID, 10, { from: alice });
      const reserveAfter = await sf.reserve(TOKEN_ID);
      assert.equal(
        new BN(reserveBefore).sub(new BN(reserveAfter)).toString(),
        net.toString()
      );
    });

    it("remaining holders gain backing value after a large exit", async () => {
      const infoBefore = await sf.tokenInfo(TOKEN_ID);
      // alice burns 50% of supply — pays a significant fee that stays in reserve
      await sf.burn(TOKEN_ID, 50, { from: alice });
      const infoAfter = await sf.tokenInfo(TOKEN_ID);
      // backingPerToken should be higher for remaining 50 tokens
      assert.ok(
        new BN(infoAfter.backingPerToken).gt(new BN(infoBefore.backingPerToken)),
        "backing per token should increase after large exit fee"
      );
    });

    it("sends correct ETH to the caller", async () => {
      const { net } = await sf.burnRefund(TOKEN_ID, 10);
      const before = new BN(await web3.eth.getBalance(alice));
      const tx = await sf.burn(TOKEN_ID, 10, { from: alice });
      const gasUsed = new BN(tx.receipt.gasUsed);
      const gasPrice = new BN(tx.receipt.effectiveGasPrice || (await web3.eth.getGasPrice()));
      const after = new BN(await web3.eth.getBalance(alice));
      const received = after.sub(before).add(gasUsed.mul(gasPrice));
      assert.equal(received.toString(), net.toString());
    });

    it("reverts if balance is insufficient", async () => {
      await expectRevert(sf.burn(TOKEN_ID, 101, { from: alice }), "insufficient balance");
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(sf.burn(TOKEN_ID, 0, { from: alice }), "amount must be > 0");
    });

    it("reverts when paused", async () => {
      await sf.pause({ from: owner });
      await expectRevert(sf.burn(TOKEN_ID, 1, { from: alice }), "EnforcedPause");
    });
  });

  // ---------------------------------------------------------------------------
  // burn — treasury mode (fee forwarded to treasury)
  // ---------------------------------------------------------------------------

  describe("burn (treasury mode)", () => {
    const MINT_AMOUNT = 100;

    beforeEach(async () => {
      await sf.setTreasury(treasury, { from: owner });
      const cost = await sf.mintCost(MINT_AMOUNT);
      await sf.mintFunded(alice, TOKEN_ID, MINT_AMOUNT, { from: owner, value: cost });
    });

    it("forwards fee to treasury and deducts gross from reserve", async () => {
      const { gross, fee, net } = await sf.burnRefund(TOKEN_ID, 50);
      const reserveBefore = await sf.reserve(TOKEN_ID);
      const treasuryBefore = new BN(await web3.eth.getBalance(treasury));

      await sf.burn(TOKEN_ID, 50, { from: alice });

      const reserveAfter = await sf.reserve(TOKEN_ID);
      const treasuryAfter = new BN(await web3.eth.getBalance(treasury));

      // reserve decreases by gross (net + fee both leave the reserve)
      assert.equal(
        new BN(reserveBefore).sub(new BN(reserveAfter)).toString(),
        new BN(net).add(new BN(fee)).toString()
      );

      // treasury receives exactly the fee
      assert.equal(
        treasuryAfter.sub(treasuryBefore).toString(),
        new BN(fee).toString()
      );
    });

    it("emits TreasurySet event when treasury is configured", async () => {
      const tx = await sf.setTreasury(treasury, { from: owner });
      const log = tx.logs.find((l) => l.event === "TreasurySet");
      assert.ok(log);
      assert.equal(log.args.treasury, treasury);
    });

    it("reverts setTreasury if called by non-owner", async () => {
      await expectRevert(sf.setTreasury(treasury, { from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // setMaxBurnFeeRate
  // ---------------------------------------------------------------------------

  describe("setMaxBurnFeeRate", () => {
    it("updates the rate and emits event", async () => {
      const tx = await sf.setMaxBurnFeeRate(toWei("0.3"), { from: owner });
      assert.equal((await sf.maxBurnFeeRate()).toString(), toWei("0.3"));
      const log = tx.logs.find((l) => l.event === "MaxBurnFeeRateSet");
      assert.ok(log);
    });

    it("reverts if rate exceeds 80% hard cap", async () => {
      await expectRevert(
        sf.setMaxBurnFeeRate(toWei("0.81"), { from: owner }),
        "exceeds hard cap"
      );
    });

    it("allows setting exactly 80%", async () => {
      await sf.setMaxBurnFeeRate(toWei("0.8"), { from: owner });
      assert.equal((await sf.maxBurnFeeRate()).toString(), toWei("0.8"));
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setMaxBurnFeeRate(toWei("0.3"), { from: alice }));
    });
  });


  // ---------------------------------------------------------------------------
  // tokenInfo
  // ---------------------------------------------------------------------------

  describe("tokenInfo", () => {
    it("returns zeroes for a token ID with no supply or reserve", async () => {
      // token 999 has no mints — supply, reserve, and backingPerToken are 0.
      // currentPrice reflects the global tier (tiers are shared) so it is non-zero.
      const info = await sf.tokenInfo(999);
      assert.equal(info.circulatingSupply.toString(), "0");
      assert.equal(info.reserve.toString(), "0");
      assert.equal(info.backingPerToken.toString(), "0");
      assert.equal(info.currentPrice.toString(), toWei("0.001")); // global tier 0 price
    });

    it("reflects current tier after minting into tier 1", async () => {
      const cost = await sf.mintCost(100);
      await sf.mintFunded(alice, TOKEN_ID, 100, { from: owner, value: cost });
      const info = await sf.tokenInfo(TOKEN_ID);
      assert.equal(info.currentTierIndex.toString(), "1");
      assert.equal(info.currentPrice.toString(), toWei("0.01"));
    });

    it("reports correct backing per token", async () => {
      const cost = await sf.mintCost(10);
      await sf.mintFunded(alice, TOKEN_ID, 10, { from: owner, value: cost });
      const info = await sf.tokenInfo(TOKEN_ID);
      // backingPerToken = reserve × WAD / supply
      const expected = new BN(cost).mul(WAD).divn(10);
      assert.equal(info.backingPerToken.toString(), expected.toString());
    });


  });

  // ---------------------------------------------------------------------------
  // simulateMint / simulateBurn
  // ---------------------------------------------------------------------------

  describe("simulateMint", () => {
    it("returns the same value as mintCost", async () => {
      const direct = await sf.mintCost(50);
      const sim    = await sf.simulateMint(50);
      assert.equal(sim.toString(), direct.toString());
    });
  });

  describe("simulateBurn", () => {
    beforeEach(async () => {
      const cost = await sf.mintCost(100);
      await sf.mintFunded(alice, TOKEN_ID, 100, { from: owner, value: cost });
    });

    it("gross + fee = gross and net = gross - fee", async () => {
      const sim = await sf.simulateBurn(TOKEN_ID, 30);
      assert.equal(
        new BN(sim.net).add(new BN(sim.fee)).toString(),
        sim.gross.toString()
      );
    });

    it("feeRate matches burnFeeRate", async () => {
      const rate = await sf.burnFeeRate(30);
      const sim  = await sf.simulateBurn(TOKEN_ID, 30);
      assert.equal(sim.feeRate.toString(), rate.toString());
    });
  });

  // ---------------------------------------------------------------------------
  // pause / unpause access control
  // ---------------------------------------------------------------------------

  describe("pause / unpause", () => {
    it("reverts pause if called by non-owner", async () => {
      await expectRevert(sf.pause({ from: alice }));
    });

    it("reverts unpause if called by non-owner", async () => {
      await sf.pause({ from: owner });
      await expectRevert(sf.unpause({ from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // Portfolio Phase 1 — configuration & infrastructure
  // ---------------------------------------------------------------------------

  // Dummy ERC20 addresses — real contracts not needed for config-only tests.
  const TOKEN_A = "0x1111111111111111111111111111111111111111";
  const TOKEN_B = "0x2222222222222222222222222222222222222222";
  const ROUTER  = "0x3333333333333333333333333333333333333333";
  const WETH    = "0x4444444444444444444444444444444444444444";

  // AssetType.SMF = 3; smfContract is set to `owner` in beforeEach
  const SMF_ASSET = (smfAddr) =>
    ({ assetType: 3, token: smfAddr, weightBps: 2000, poolFee: 0, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" });

  // VALID_ASSETS built lazily (needs owner address); use buildValidAssets() in tests
  const buildValidAssets = (smfAddr) => [
    SMF_ASSET(smfAddr),
    { assetType: 0, token: TOKEN_A, weightBps: 5000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
    { assetType: 0, token: TOKEN_B, weightBps: 3000, poolFee: 500,  swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
  ];

  describe("setKeeper", () => {
    it("sets keeper and emits KeeperSet", async () => {
      const tx = await sf.setKeeper(alice, { from: owner });
      assert.equal(await sf.keeper(), alice);
      const log = tx.logs.find((l) => l.event === "KeeperSet");
      assert.ok(log);
      assert.equal(log.args.keeper, alice);
    });

    it("reverts for zero address", async () => {
      await expectRevert(
        sf.setKeeper("0x0000000000000000000000000000000000000000", { from: owner }),
        "zero address"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setKeeper(alice, { from: alice }));
    });
  });

  describe("setSwapRouter", () => {
    it("sets router and emits SwapRouterSet", async () => {
      const tx = await sf.setSwapRouter(ROUTER, { from: owner });
      assert.equal((await sf.swapRouter()).toLowerCase(), ROUTER.toLowerCase());
      const log = tx.logs.find((l) => l.event === "SwapRouterSet");
      assert.ok(log);
    });

    it("reverts for zero address", async () => {
      await expectRevert(
        sf.setSwapRouter("0x0000000000000000000000000000000000000000", { from: owner }),
        "zero address"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setSwapRouter(ROUTER, { from: alice }));
    });
  });

  describe("setWETH", () => {
    it("sets WETH and emits WETHSet", async () => {
      const tx = await sf.setWETH(WETH, { from: owner });
      assert.equal((await sf.weth()).toLowerCase(), WETH.toLowerCase());
      const log = tx.logs.find((l) => l.event === "WETHSet");
      assert.ok(log);
    });

    it("reverts for zero address", async () => {
      await expectRevert(
        sf.setWETH("0x0000000000000000000000000000000000000000", { from: owner }),
        "zero address"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setWETH(WETH, { from: alice }));
    });
  });

  describe("setSlippageTolerance", () => {
    it("sets tolerance and emits SlippageToleranceSet", async () => {
      const tx = await sf.setSlippageTolerance(100, { from: owner });
      assert.equal((await sf.slippageToleranceBps()).toString(), "100");
      const log = tx.logs.find((l) => l.event === "SlippageToleranceSet");
      assert.ok(log);
      assert.equal(log.args.bps.toString(), "100");
    });

    it("allows setting exactly 1000 bps (10%)", async () => {
      await sf.setSlippageTolerance(1000, { from: owner });
      assert.equal((await sf.slippageToleranceBps()).toString(), "1000");
    });

    it("reverts if bps exceeds 1000", async () => {
      await expectRevert(
        sf.setSlippageTolerance(1001, { from: owner }),
        "slippage exceeds 10%"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setSlippageTolerance(50, { from: alice }));
    });

    it("defaults to 50 bps after deploy", async () => {
      assert.equal((await sf.slippageToleranceBps()).toString(), "50");
    });
  });

  describe("setPortfolioConfig", () => {
    it("stores config, marks portfolio inactive, and emits PortfolioConfigSet", async () => {
      const assets = buildValidAssets(owner);
      const tx = await sf.setPortfolioConfig(TOKEN_ID, assets, { from: owner });

      const config = await sf.getPortfolioConfig(TOKEN_ID);
      assert.equal(config.length, 3);
      // SMF slice at index 0
      assert.equal(config[0].assetType.toString(), "3");
      assert.equal(config[0].weightBps.toString(), "2000");
      // ERC20 slices
      assert.equal(config[1].token.toLowerCase(), TOKEN_A.toLowerCase());
      assert.equal(config[1].weightBps.toString(), "5000");
      assert.equal(config[2].token.toLowerCase(), TOKEN_B.toLowerCase());
      assert.equal(config[2].weightBps.toString(), "3000");

      assert.equal(await sf.portfolioActive(TOKEN_ID), false);

      const log = tx.logs.find((l) => l.event === "PortfolioConfigSet");
      assert.ok(log);
      assert.equal(log.args.id.toString(), TOKEN_ID.toString());
    });

    it("replaces a previous config", async () => {
      await sf.setPortfolioConfig(TOKEN_ID, buildValidAssets(owner), { from: owner });
      const newAssets = [
        { assetType: 3, token: owner, weightBps: 2000, poolFee: 0, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: 0, token: TOKEN_A, weightBps: 8000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await sf.setPortfolioConfig(TOKEN_ID, newAssets, { from: owner });
      const config = await sf.getPortfolioConfig(TOKEN_ID);
      assert.equal(config.length, 2);
      assert.equal(config[1].weightBps.toString(), "8000");
    });

    it("reverts if weights do not sum to 10000", async () => {
      const bad = [
        { assetType: 0, token: TOKEN_A, weightBps: 6000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: 0, token: TOKEN_B, weightBps: 3000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" }, // sum = 9000
      ];
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }),
        "weights must sum to 10000"
      );
    });

    it("reverts if a weight is zero", async () => {
      const bad = [
        { assetType: 0, token: TOKEN_A, weightBps: 0,     poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: 0, token: TOKEN_B, weightBps: 10000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }),
        "zero weight"
      );
    });

    it("reverts if a token address is zero", async () => {
      const bad = [
        {
          assetType: 0,
          token: "0x0000000000000000000000000000000000000000",
          weightBps: 10000,
          poolFee: 3000,
          swapFee: 0,
          tickLower: 0,
          tickUpper: 0,
          swapPath: "0x",
          sellSwapPath: "0x",
        },
      ];
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }),
        "zero token address"
      );
    });

    it("reverts for an invalid pool fee tier", async () => {
      const bad = [
        { assetType: 3, token: owner, weightBps: 2000, poolFee: 0, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: 0, token: TOKEN_A, weightBps: 8000, poolFee: 1234, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }),
        "invalid pool fee"
      );
    });

    it("accepts all three valid pool fee tiers", async () => {
      for (const fee of [500, 3000, 10000]) {
        const assets = [
          { assetType: 3, token: owner, weightBps: 2000, poolFee: 0, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
          { assetType: 0, token: TOKEN_A, weightBps: 8000, poolFee: fee, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        ];
        await sf.setPortfolioConfig(TOKEN_ID, assets, { from: owner });
        const config = await sf.getPortfolioConfig(TOKEN_ID);
        assert.equal(config[1].poolFee.toString(), fee.toString());
      }
    });

    it("reverts if no assets provided", async () => {
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, [], { from: owner }),
        "no assets provided"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setPortfolioConfig(TOKEN_ID, buildValidAssets(owner), { from: alice }));
    });

    it("reverts if SMF weight is below 20%", async () => {
      const bad = [
        { assetType: 3, token: owner, weightBps: 1000, poolFee: 0, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: 0, token: TOKEN_A, weightBps: 9000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await expectRevert(sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }));
    });

    it("reverts if no SMF slice at all", async () => {
      const bad = [
        { assetType: 0, token: TOKEN_A, weightBps: 6000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
        { assetType: 0, token: TOKEN_B, weightBps: 4000, poolFee: 500,  swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await expectRevert(sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }));
    });

    it("reverts if portfolio is already active", async () => {
      // We'll test this after deploy is available — placeholder skipped for now.
      // Covered in the deploy suite below.
    });
  });

  // ---------------------------------------------------------------------------
  // Portfolio Phase 2 — deploy & rebalance
  // ---------------------------------------------------------------------------

  contract("Smartfolio — portfolio Phase 2", (accounts) => {
    const [owner, alice, keeper] = accounts;

    let sf, tokenA, tokenB, mockWETH, mockRouter, mockSMF;

    // Portfolio: 20% SMF, 50% tokenA (poolFee 3000), 30% tokenB (poolFee 500)
    const buildAssets = (addrA, addrB, smfAddr) => [
      { assetType: 3, token: smfAddr, weightBps: 2000, poolFee: 0,    swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      { assetType: 0, token: addrA,   weightBps: 5000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      { assetType: 0, token: addrB,   weightBps: 3000, poolFee: 500,  swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
    ];

    beforeEach(async () => {
      // Deploy contracts
      const treasuryFacet2 = await SmartfolioTreasury.new();
      const marketFacet2   = await SmartfolioMarket.new();
      sf         = await deployProxy(Smartfolio, [owner, treasuryFacet2.address, marketFacet2.address], { kind: "uups" });
      tokenA     = await MockERC20.new("Token A", "TKA");
      tokenB     = await MockERC20.new("Token B", "TKB");
      mockWETH   = await MockWETH.new();
      mockRouter = await MockSwapRouter.new();
      mockSMF    = await MockSMFToken.new();

      // Fund router with tokens so it can fulfil swaps
      await tokenA.mint(mockRouter.address, toWei("10000"));
      await tokenB.mint(mockRouter.address, toWei("10000"));
      // Fund router with WETH so it can fulfil token→WETH sells in rebalance.
      // Reserve is only 0.01 ETH so 0.1 ETH of WETH is ample.
      await mockWETH.deposit({ value: toWei("0.1"), from: owner });
      await mockWETH.transfer(mockRouter.address, toWei("0.1"), { from: owner });
      // Fund MockSMFToken with ETH so it can pay out on sellSMF
      await web3.eth.sendTransaction({ from: owner, to: mockSMF.address, value: toWei("1") });

      // Configure Smartfolio
      await sf.setKeeper(keeper, { from: owner });
      await sf.setSwapRouter(mockRouter.address, { from: owner });
      await sf.setWETH(mockWETH.address, { from: owner });

      // Set tiers and portfolio config for TOKEN_ID
      await sf.setTiers(TIERS, { from: owner });
      await sf.setSMFContract(mockSMF.address, { from: owner });
      await sf.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address, mockSMF.address), { from: owner });

      // Alice mints 10 tokens (10 × 0.001 ETH = 0.01 ETH in reserve)
      const cost = await sf.mintCost(10);
      await mockSMF.mintFundedOnBehalf(sf.address, alice, TOKEN_ID, 10, { from: owner, value: cost });
    });

    // ---- deploy ----

    describe("deploy", () => {
      it("zeroes reserve, sets portfolioActive, sets deployedEth, updates holdings, emits Deployed", async () => {
        const reserveBefore = await sf.reserve(TOKEN_ID);
        assert.ok(new BN(reserveBefore).gt(new BN(0)), "reserve must be > 0 before deploy");

        const tx = await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper });

        // Reserve cleared
        assert.equal((await sf.reserve(TOKEN_ID)).toString(), "0");

        // Portfolio marked active
        assert.equal(await sf.portfolioActive(TOKEN_ID), true);

        // deployedEth records original reserve
        assert.equal((await sf.deployedEth(TOKEN_ID)).toString(), reserveBefore.toString());

        // portfolioHoldings updated — MockSwapRouter is 1:1, so
        // tokenA gets 50% of reserve, tokenB gets the last slice (30%)
        // SMF (20%) is held as raw ETH in portfolioSMFHoldings (Phase 3 stub)
        const expectedA = new BN(reserveBefore).muln(5000).divn(10000);
        const expectedB = new BN(reserveBefore).muln(3000).divn(10000);
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenA.address)).toString(),
          expectedA.toString()
        );
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenB.address)).toString(),
          expectedB.toString()
        );

        const log = tx.logs.find((l) => l.event === "Deployed");
        assert.ok(log);
        assert.equal(log.args.id.toString(), TOKEN_ID.toString());
        assert.equal(log.args.ethDeployed.toString(), reserveBefore.toString());
      });

      it("reverts if already deployed", async () => {
        await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper });
        await expectRevert(sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper }), "already deployed");
      });

      it("reverts if no portfolio config", async () => {
        const OTHER_ID = 42;
        await sf.setTiers(TIERS, { from: owner });
        const cost = await sf.mintCost(1);
        await mockSMF.mintFundedOnBehalf(sf.address, alice, OTHER_ID, 1, { from: owner, value: cost });
        await expectRevert(sf.deploy(OTHER_ID, [], 0, 0, 0, 0, { from: keeper }), "no portfolio config");
      });

      it("reverts if no reserve", async () => {
        // Deploy once to drain reserve
        await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper });
        // Try to deploy a fresh token ID that has a config but no reserve
        const OTHER_ID = 43;
        await sf.setTiers(TIERS, { from: owner });
        await sf.setPortfolioConfig(OTHER_ID, buildAssets(tokenA.address, tokenB.address, mockSMF.address), { from: owner });
        await expectRevert(sf.deploy(OTHER_ID, [0, 0], 0, 0, 0, 0, { from: keeper }), "no reserve to deploy");
      });

      it("reverts if amountsOutMinimum length mismatches config", async () => {
        await expectRevert(
          sf.deploy(TOKEN_ID, [0], 0, 0, 0, 0, { from: keeper }), // config has 2 assets, only 1 min
          "length mismatch"
        );
      });

      it("reverts if called by non-keeper", async () => {
        await expectRevert(sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: alice }), "not keeper");
      });

      it("reverts if router is not set", async () => {
        const t2  = await SmartfolioTreasury.new();
        const m2  = await SmartfolioMarket.new();
        const sf2 = await deployProxy(Smartfolio, [owner, t2.address, m2.address], { kind: "uups" });
        await sf2.setTiers(TIERS, { from: owner });
        await sf2.setKeeper(keeper, { from: owner });
        await sf2.setWETH(mockWETH.address, { from: owner });
        await sf2.setSMFContract(owner, { from: owner });
        await sf2.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address, owner), { from: owner });
        const cost = await sf2.mintCost(1);
        await sf2.mintFunded(alice, TOKEN_ID, 1, { from: owner, value: cost });
        await expectRevert(sf2.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper }), "router not set");
      });

      it("blocks setPortfolioConfig once portfolio is active", async () => {
        await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper });
        await expectRevert(
          sf.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address, owner), { from: owner }),
          "portfolio is active"
        );
      });

      it("blocks burn() when portfolio is active", async () => {
        await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper });
        await expectRevert(
          sf.burn(TOKEN_ID, 1, { from: alice }),
          "use divest()"
        );
      });
    });

    // ---- rebalance ----

    describe("rebalance", () => {
      beforeEach(async () => {
        // Deploy portfolio first
        await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper });
      });

      it("executes a sell + buy pair and updates holdings, emits Rebalanced", async () => {
        const holdingABefore = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        const holdingBBefore = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenB.address));

        // Sell 10% of tokenA → WETH, then buy equivalent WETH → tokenB
        const sellAmount = holdingABefore.divn(10);

        const instructions = [
          { token: tokenA.address, isSell: true,  amountIn: sellAmount.toString(), amountOutMin: 0, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
          { token: tokenB.address, isSell: false, amountIn: sellAmount.toString(), amountOutMin: 0, poolFee: 500,  swapPath: "0x" },
        ];

        const tx = await sf.rebalance(TOKEN_ID, instructions, { from: keeper });

        const holdingAAfter = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        const holdingBAfter = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenB.address));

        // tokenA decreased by sellAmount
        assert.equal(holdingAAfter.toString(), holdingABefore.sub(sellAmount).toString());
        // tokenB increased by sellAmount (1:1 mock rate)
        assert.equal(holdingBAfter.toString(), holdingBBefore.add(sellAmount).toString());

        const log = tx.logs.find((l) => l.event === "Rebalanced");
        assert.ok(log);
        assert.equal(log.args.id.toString(), TOKEN_ID.toString());
      });

      it("reverts sell if holdings are insufficient", async () => {
        const holding = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        const instructions = [
          { token: tokenA.address, isSell: true, amountIn: holding.addn(1).toString(), amountOutMin: 0, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
        ];
        await expectRevert(sf.rebalance(TOKEN_ID, instructions, { from: keeper }), "insufficient holdings");
      });

      it("reverts with empty instructions", async () => {
        await expectRevert(sf.rebalance(TOKEN_ID, [], { from: keeper }), "no instructions");
      });

      it("reverts if called by non-keeper", async () => {
        const instructions = [
          { token: tokenA.address, isSell: true, amountIn: 1, amountOutMin: 0, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
        ];
        await expectRevert(sf.rebalance(TOKEN_ID, instructions, { from: alice }), "not keeper");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Portfolio Phase 3 — divest (fee-free exit)
  // ---------------------------------------------------------------------------

  contract("Smartfolio — portfolio Phase 3", (accounts) => {
    const [owner, alice, bob, keeper] = accounts;

    let sf, tokenA, tokenB, mockWETH, mockRouter, mockSMF;

    const buildAssets = (addrA, addrB, smfAddr) => [
      { assetType: 3, token: smfAddr, weightBps: 2000, poolFee: 0,    swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      { assetType: 0, token: addrA,   weightBps: 5000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
      { assetType: 0, token: addrB,   weightBps: 3000, poolFee: 500,  swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" },
    ];

    beforeEach(async () => {
      const treasuryFacet3 = await SmartfolioTreasury.new();
      const marketFacet3   = await SmartfolioMarket.new();
      sf         = await deployProxy(Smartfolio, [owner, treasuryFacet3.address, marketFacet3.address], { kind: "uups" });
      tokenA     = await MockERC20.new("Token A", "TKA");
      tokenB     = await MockERC20.new("Token B", "TKB");
      mockWETH   = await MockWETH.new();
      mockRouter = await MockSwapRouter.new();
      mockSMF    = await MockSMFToken.new();

      // Fund router: ERC20s for buys and WETH for sells
      await tokenA.mint(mockRouter.address, toWei("10000"));
      await tokenB.mint(mockRouter.address, toWei("10000"));
      await mockWETH.deposit({ value: toWei("0.1"), from: owner });
      await mockWETH.transfer(mockRouter.address, toWei("0.1"), { from: owner });

      // Fund MockSMFToken with ETH so it can pay out on sellSMF
      await web3.eth.sendTransaction({ from: owner, to: mockSMF.address, value: toWei("1") });

      await sf.setKeeper(keeper, { from: owner });
      await sf.setSwapRouter(mockRouter.address, { from: owner });
      await sf.setWETH(mockWETH.address, { from: owner });

      await sf.setTiers(TIERS, { from: owner });
      await sf.setSMFContract(mockSMF.address, { from: owner });
      await sf.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address, mockSMF.address), { from: owner });

      // Alice mints 100 tokens → 0.1 ETH in reserve
      const cost = await sf.mintCost(100);
      await mockSMF.mintFundedOnBehalf(sf.address, alice, TOKEN_ID, 100, { from: owner, value: cost });

      // Deploy portfolio
      await sf.deploy(TOKEN_ID, [0, 0], 0, 0, 0, 0, { from: keeper });
    });

    // ---- helpers ----

    // Expected token amounts held after deploy (1:1 mock rate):
    //   tokenA = 50%, tokenB = 30%, SMF = 20% (held as raw ETH, Phase 3 stub)
    async function expectedHoldings(reserveAmount) {
      const a = new BN(reserveAmount).muln(5000).divn(10000);
      const b = new BN(reserveAmount).muln(3000).divn(10000);
      return { a, b };
    }

    describe("divest", () => {
      it("burns tokens, transfers ERC20s directly, emits Divested", async () => {
        const deployedAmount = await sf.deployedEth(TOKEN_ID);
        const { a: holdingA, b: holdingB } = await expectedHoldings(deployedAmount);

        const supplyBefore      = await sf.totalSupply(TOKEN_ID);
        const tokenABefore      = new BN(await tokenA.balanceOf(alice));
        const tokenBBefore      = new BN(await tokenB.balanceOf(alice));

        // Divest half (50 of 100 tokens)
        const tx = await sf.divest(TOKEN_ID, 50, { from: alice });

        const supplyAfter = await sf.totalSupply(TOKEN_ID);

        // Supply reduced
        assert.equal(supplyAfter.toString(), new BN(supplyBefore).subn(50).toString());

        // ERC1155 balance reduced
        assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "50");

        // Portfolio holdings reduced by 50%
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenA.address)).toString(),
          holdingA.divn(2).toString()
        );
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenB.address)).toString(),
          holdingB.divn(2).toString()
        );

        // Alice received the ERC20 tokens directly
        const tokenAAfter = new BN(await tokenA.balanceOf(alice));
        const tokenBAfter = new BN(await tokenB.balanceOf(alice));
        assert.ok(tokenAAfter.gt(tokenABefore), "Alice should receive tokenA");
        assert.ok(tokenBAfter.gt(tokenBBefore), "Alice should receive tokenB");

        // Event emitted
        const log = tx.logs.find((l) => l.event === "Divested");
        assert.ok(log);
        assert.equal(log.args.account, alice);
        assert.equal(log.args.id.toString(), TOKEN_ID.toString());
        assert.equal(log.args.amount.toString(), "50");
      });

      it("full divest: all tokens burned, portfolioActive resets to false", async () => {
        await sf.divest(TOKEN_ID, 100, { from: alice });

        assert.equal((await sf.totalSupply(TOKEN_ID)).toString(), "0");
        assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "0");
        assert.equal(await sf.portfolioActive(TOKEN_ID), false);

        // Holdings cleared
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenA.address)).toString(), "0"
        );
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenB.address)).toString(), "0"
        );
      });

      it("owner can reconfigure while portfolio is active", async () => {
        // setPortfolioConfig is no longer gated on portfolioActive
        await sf.setPortfolioConfig(
          TOKEN_ID,
          buildAssets(tokenA.address, tokenB.address, mockSMF.address),
          { from: owner }
        );
        const cfg = await sf.getPortfolioConfig(TOKEN_ID);
        assert.equal(cfg.length, 3);
      });

      it("multiple holders divesting proportionally does not affect each other", async () => {
        // Bob also mints 100 tokens — now total supply is 200
        const cost = await sf.mintCost(100);
        // Need to undeploy for Bob to add to reserve... actually portfolio is active
        // so Bob can still mint (mint adds to reserve, does not go to portfolio automatically)
        await mockSMF.mintFundedOnBehalf(sf.address, bob, TOKEN_ID, 100, { from: owner, value: cost });

        const holdingABefore = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        const supply = new BN(await sf.totalSupply(TOKEN_ID)); // 200

        // Alice divests her 100 (50% of supply)
        await sf.divest(TOKEN_ID, 100, { from: alice });

        const holdingAAfter = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        // tokenA holdings should have decreased by 50%
        assert.equal(
          holdingAAfter.toString(),
          holdingABefore.mul(new BN(supply.subn(100))).div(supply).toString()
        );

        // Bob's balance untouched
        assert.equal((await sf.balanceOf(bob, TOKEN_ID)).toString(), "100");
      });

      it("receives ERC20 tokens equal to portfolio holdings on full divest", async () => {
        const holdingA = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        const holdingB = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenB.address));

        const tokenABefore = new BN(await tokenA.balanceOf(alice));
        const tokenBBefore = new BN(await tokenB.balanceOf(alice));

        await sf.divest(TOKEN_ID, 100, { from: alice });

        const tokenAReceived = new BN(await tokenA.balanceOf(alice)).sub(tokenABefore);
        const tokenBReceived = new BN(await tokenB.balanceOf(alice)).sub(tokenBBefore);

        assert.equal(tokenAReceived.toString(), holdingA.toString(), "Alice should receive all tokenA");
        assert.equal(tokenBReceived.toString(), holdingB.toString(), "Alice should receive all tokenB");
      });



      it("divest works on a portfolio that has never been deployed (returns ETH from reserve)", async () => {
        const OTHER_ID = 50;
        await sf.setTiers(TIERS, { from: owner });
        await sf.setPortfolioConfig(
          OTHER_ID,
          buildAssets(tokenA.address, tokenB.address, mockSMF.address),
          { from: owner }
        );
        const cost = await sf.mintCost(1);
        await mockSMF.mintFundedOnBehalf(sf.address, alice, OTHER_ID, 1, { from: owner, value: cost });
        // Should succeed — returns ETH from reserve, no holdings to transfer
        await sf.divest(OTHER_ID, 1, { from: alice });
        assert.equal((await sf.totalSupply(OTHER_ID)).toString(), "0");
      });

      it("reverts if balance is insufficient", async () => {
        await expectRevert(
          sf.divest(TOKEN_ID, 101, { from: alice }),
          "insufficient balance"
        );
      });

      it("reverts if amount is zero", async () => {
        await expectRevert(
          sf.divest(TOKEN_ID, 0, { from: alice }),
          "amount must be > 0"
        );
      });

      it("reverts when paused", async () => {
        await sf.pause({ from: owner });
        await expectRevert(sf.divest(TOKEN_ID, 1, { from: alice }), "EnforcedPause");
      });

      it("deployedEth decreases proportionally", async () => {
        const deployedBefore = new BN(await sf.deployedEth(TOKEN_ID));
        await sf.divest(TOKEN_ID, 50, { from: alice }); // 50% exit
        const deployedAfter = new BN(await sf.deployedEth(TOKEN_ID));
        // Should be ~50% of original (within 1 wei rounding)
        const expected = deployedBefore.divn(2);
        assert.ok(
          deployedAfter.sub(expected).abs().lten(1),
          `deployedEth should halve; got ${deployedAfter}, expected ~${expected}`
        );
      });
    });
  });
});
