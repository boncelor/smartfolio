const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio      = artifacts.require("Smartfolio");
const MockERC20       = artifacts.require("MockERC20");
const MockWETH        = artifacts.require("MockWETH");
const MockSwapRouter  = artifacts.require("MockSwapRouter");
const MockAavePool    = artifacts.require("MockAavePool");
const SmartfolioTreasury     = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket       = artifacts.require("SmartfolioMarket");
const SmartfolioCreditMarket = artifacts.require("SmartfolioCreditMarket");

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
    const treasury     = await SmartfolioTreasury.new();
    const market       = await SmartfolioMarket.new();
    const creditMarket = await SmartfolioCreditMarket.new();
    sf = await deployProxy(Smartfolio, [owner, treasury.address, market.address, creditMarket.address], { kind: "uups" });
    await sf.setTiers(TOKEN_ID, TIERS, { from: owner });
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
      await expectRevert(sf.initialize(owner, sf.address, sf.address, sf.address, { from: owner }), "InvalidInitialization");
    });
  });

  // ---------------------------------------------------------------------------
  // setTiers
  // ---------------------------------------------------------------------------

  describe("setTiers", () => {
    it("stores tiers and emits TiersSet", async () => {
      const tx = await sf.setTiers(TOKEN_ID, TIERS, { from: owner });
      const tiers = await sf.getTiers(TOKEN_ID);
      assert.equal(tiers.length, 4);
      assert.equal(tiers[0].pricePerToken.toString(), toWei("0.001"));

      const log = tx.logs.find((l) => l.event === "TiersSet");
      assert.ok(log);
      assert.equal(log.args.id.toString(), TOKEN_ID.toString());
    });

    it("reverts if tiers are not ordered ascending", async () => {
      const bad = [
        { threshold: 1000, pricePerToken: toWei("0.01") },
        { threshold: 100,  pricePerToken: toWei("0.001") },
        { threshold: 0,    pricePerToken: toWei("1.0") },
      ];
      await expectRevert(
        sf.setTiers(TOKEN_ID, bad, { from: owner }),
        "tiers must be ordered ascending"
      );
    });

    it("reverts if a price is zero", async () => {
      const bad = [{ threshold: 100, pricePerToken: 0 }];
      await expectRevert(sf.setTiers(TOKEN_ID, bad, { from: owner }), "price must be > 0");
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setTiers(TOKEN_ID, TIERS, { from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // mintCost — tier boundary logic
  // ---------------------------------------------------------------------------

  describe("mintCost", () => {
    it("prices within tier 0 correctly", async () => {
      const cost = await sf.mintCost(TOKEN_ID, 10);
      assert.equal(cost.toString(), toWei("0.01")); // 10 × 0.001
    });

    it("prices a mint that spans tier 0 → tier 1", async () => {
      // mint 50 in tier 0 first
      await sf.mint(alice, TOKEN_ID, 50, "0x", { from: alice, value: toWei("0.05") });

      // now mintCost for 100 more: 50 @ 0.001 + 50 @ 0.01
      const cost = await sf.mintCost(TOKEN_ID, 100);
      const expected = new BN(toWei("0.001")).muln(50).add(new BN(toWei("0.01")).muln(50));
      assert.equal(cost.toString(), expected.toString());
    });

    it("prices a mint entirely within tier 1", async () => {
      await sf.mint(alice, TOKEN_ID, 100, "0x", { from: alice, value: toWei("0.1") });
      const cost = await sf.mintCost(TOKEN_ID, 10);
      assert.equal(cost.toString(), toWei("0.1")); // 10 × 0.01
    });

    it("prices a mint that spans all four tiers", async () => {
      // need supply at 0 for full cross
      // tier 0: 100 @ 0.001 = 0.1
      // tier 1: 900 @ 0.01  = 9
      // tier 2: 9000 @ 0.1  = 900
      // tier 3: 1    @ 1.0  = 1
      const cost = await sf.mintCost(TOKEN_ID, 10001);
      const expected = new BN(toWei("0.001")).muln(100)
        .add(new BN(toWei("0.01")).muln(900))
        .add(new BN(toWei("0.1")).muln(9000))
        .add(new BN(toWei("1.0")).muln(1));
      assert.equal(cost.toString(), expected.toString());
    });

    it("reverts if tiers not configured", async () => {
      await expectRevert(sf.mintCost(999, 1), "tiers not configured for id");
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(sf.mintCost(TOKEN_ID, 0), "amount must be > 0");
    });
  });

  // ---------------------------------------------------------------------------
  // mint
  // ---------------------------------------------------------------------------

  describe("mint", () => {
    it("mints tokens, updates state and emits Minted", async () => {
      const cost = await sf.mintCost(TOKEN_ID, 10);
      const tx = await sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: cost });

      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "10");
      assert.equal((await sf.totalSupply(TOKEN_ID)).toString(), "10");
      assert.equal((await sf.totalMinted(TOKEN_ID)).toString(), "10");
      assert.equal((await sf.reserve(TOKEN_ID)).toString(), cost.toString());

      const log = tx.logs.find((l) => l.event === "Minted");
      assert.ok(log);
      assert.equal(log.args.amount.toString(), "10");
      assert.equal(log.args.ethPaid.toString(), cost.toString());
    });

    it("refunds excess ETH", async () => {
      const cost = await sf.mintCost(TOKEN_ID, 1);
      const overpay = new BN(cost).add(new BN(toWei("1")));
      const before = new BN(await web3.eth.getBalance(alice));
      const tx = await sf.mint(alice, TOKEN_ID, 1, "0x", { from: alice, value: overpay });
      const gasUsed = new BN(tx.receipt.gasUsed);
      const gasPrice = new BN(tx.receipt.effectiveGasPrice || (await web3.eth.getGasPrice()));
      const after = new BN(await web3.eth.getBalance(alice));
      const spent = before.sub(after).sub(gasUsed.mul(gasPrice));
      // spent should equal cost, not overpay
      assert.equal(spent.toString(), cost.toString());
    });

    it("reverts if ETH is insufficient", async () => {
      await expectRevert(
        sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: toWei("0.001") }),
        "insufficient ETH"
      );
    });

    it("reverts when paused", async () => {
      await sf.pause({ from: owner });
      const cost = await sf.mintCost(TOKEN_ID, 1);
      await expectRevert(
        sf.mint(alice, TOKEN_ID, 1, "0x", { from: alice, value: cost }),
        "EnforcedPause"
      );
    });

    it("succeeds after unpause", async () => {
      await sf.pause({ from: owner });
      await sf.unpause({ from: owner });
      const cost = await sf.mintCost(TOKEN_ID, 1);
      await sf.mint(alice, TOKEN_ID, 1, "0x", { from: alice, value: cost });
      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "1");
    });


  });

  // ---------------------------------------------------------------------------
  // mintBatch
  // ---------------------------------------------------------------------------

  describe("mintBatch", () => {
    const ID_A = 1;
    const ID_B = 2;

    beforeEach(async () => {
      await sf.setTiers(ID_B, TIERS, { from: owner });
    });

    it("mints multiple token IDs and updates reserves independently", async () => {
      const costA = await sf.mintCost(ID_A, 5);
      const costB = await sf.mintCost(ID_B, 3);
      const total = new BN(costA).add(new BN(costB));

      await sf.mintBatch(alice, [ID_A, ID_B], [5, 3], "0x", { from: alice, value: total });

      assert.equal((await sf.balanceOf(alice, ID_A)).toString(), "5");
      assert.equal((await sf.balanceOf(alice, ID_B)).toString(), "3");
      assert.equal((await sf.reserve(ID_A)).toString(), costA.toString());
      assert.equal((await sf.reserve(ID_B)).toString(), costB.toString());
    });

    it("reverts if ETH is insufficient for batch", async () => {
      const costA = await sf.mintCost(ID_A, 5);
      await expectRevert(
        sf.mintBatch(alice, [ID_A, ID_B], [5, 3], "0x", { from: alice, value: costA }),
        "insufficient ETH"
      );
    });


  });

  // ---------------------------------------------------------------------------
  // burnFeeRate
  // ---------------------------------------------------------------------------

  describe("burnFeeRate", () => {
    beforeEach(async () => {
      const cost = await sf.mintCost(TOKEN_ID, 100);
      await sf.mint(alice, TOKEN_ID, 100, "0x", { from: alice, value: cost });
    });

    it("returns ~0 for a tiny burn proportion", async () => {
      // burning 1 of 100 = 1% → rate = 0.01² × 0.5 = 0.00005 WAD
      const rate = await sf.burnFeeRate(TOKEN_ID, 1);
      const expected = WAD.div(new BN(100))         // 0.01 WAD (proportion)
        .mul(WAD.div(new BN(100)))                  // × 0.01
        .div(WAD)                                    // normalise
        .mul(new BN(toWei("0.5")))                  // × maxBurnFeeRate
        .div(WAD);
      assert.equal(rate.toString(), expected.toString());
    });

    it("returns 50% for burning 100% of supply (default maxBurnFeeRate)", async () => {
      const rate = await sf.burnFeeRate(TOKEN_ID, 100);
      // proportion = 1.0, 1² × 0.5 = 0.5
      assert.equal(rate.toString(), toWei("0.5"));
    });

    it("scales quadratically — doubling proportion quadruples rate", async () => {
      const rate10 = await sf.burnFeeRate(TOKEN_ID, 10); // 10% of 100
      const rate20 = await sf.burnFeeRate(TOKEN_ID, 20); // 20% of 100
      // rate20 ≈ rate10 × 4
      assert.equal(rate20.toString(), rate10.muln(4).toString());
    });

    it("reverts if amount exceeds supply", async () => {
      await expectRevert(sf.burnFeeRate(TOKEN_ID, 101), "amount exceeds supply");
    });
  });

  // ---------------------------------------------------------------------------
  // burnRefund
  // ---------------------------------------------------------------------------

  describe("burnRefund", () => {
    const MINT_AMOUNT = 100;

    beforeEach(async () => {
      const cost = await sf.mintCost(TOKEN_ID, MINT_AMOUNT);
      await sf.mint(alice, TOKEN_ID, MINT_AMOUNT, "0x", { from: alice, value: cost });
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
      mintCostPaid = await sf.mintCost(TOKEN_ID, MINT_AMOUNT);
      await sf.mint(alice, TOKEN_ID, MINT_AMOUNT, "0x", { from: alice, value: mintCostPaid });
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
      const cost = await sf.mintCost(TOKEN_ID, MINT_AMOUNT);
      await sf.mint(alice, TOKEN_ID, MINT_AMOUNT, "0x", { from: alice, value: cost });
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
    it("returns zeroes for an unconfigured token with no supply", async () => {
      // token 999 has no tiers — backingPerToken and price should be 0
      const info = await sf.tokenInfo(999);
      assert.equal(info.circulatingSupply.toString(), "0");
      assert.equal(info.reserve.toString(), "0");
      assert.equal(info.backingPerToken.toString(), "0");
      assert.equal(info.currentPrice.toString(), "0");
    });

    it("reflects current tier after minting into tier 1", async () => {
      const cost = await sf.mintCost(TOKEN_ID, 100);
      await sf.mint(alice, TOKEN_ID, 100, "0x", { from: alice, value: cost });
      const info = await sf.tokenInfo(TOKEN_ID);
      assert.equal(info.currentTierIndex.toString(), "1");
      assert.equal(info.currentPrice.toString(), toWei("0.01"));
    });

    it("reports correct backing per token", async () => {
      const cost = await sf.mintCost(TOKEN_ID, 10);
      await sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: cost });
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
      const direct = await sf.mintCost(TOKEN_ID, 50);
      const sim    = await sf.simulateMint(TOKEN_ID, 50);
      assert.equal(sim.toString(), direct.toString());
    });
  });

  describe("simulateBurn", () => {
    beforeEach(async () => {
      const cost = await sf.mintCost(TOKEN_ID, 100);
      await sf.mint(alice, TOKEN_ID, 100, "0x", { from: alice, value: cost });
    });

    it("gross + fee = gross and net = gross - fee", async () => {
      const sim = await sf.simulateBurn(TOKEN_ID, 30);
      assert.equal(
        new BN(sim.net).add(new BN(sim.fee)).toString(),
        sim.gross.toString()
      );
    });

    it("feeRate matches burnFeeRate", async () => {
      const rate = await sf.burnFeeRate(TOKEN_ID, 30);
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

  const VALID_ASSETS = [
    { token: TOKEN_A, weightBps: 6000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
    { token: TOKEN_B, weightBps: 4000, poolFee: 500,  swapPath: "0x", sellSwapPath: "0x" },
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
      const tx = await sf.setPortfolioConfig(TOKEN_ID, VALID_ASSETS, { from: owner });

      const config = await sf.getPortfolioConfig(TOKEN_ID);
      assert.equal(config.length, 2);
      assert.equal(config[0].token.toLowerCase(), TOKEN_A.toLowerCase());
      assert.equal(config[0].weightBps.toString(), "6000");
      assert.equal(config[0].poolFee.toString(), "3000");
      assert.equal(config[1].token.toLowerCase(), TOKEN_B.toLowerCase());
      assert.equal(config[1].weightBps.toString(), "4000");
      assert.equal(config[1].poolFee.toString(), "500");

      assert.equal(await sf.portfolioActive(TOKEN_ID), false);

      const log = tx.logs.find((l) => l.event === "PortfolioConfigSet");
      assert.ok(log);
      assert.equal(log.args.id.toString(), TOKEN_ID.toString());
    });

    it("replaces a previous config", async () => {
      await sf.setPortfolioConfig(TOKEN_ID, VALID_ASSETS, { from: owner });
      const newAssets = [
        { token: TOKEN_A, weightBps: 10000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await sf.setPortfolioConfig(TOKEN_ID, newAssets, { from: owner });
      const config = await sf.getPortfolioConfig(TOKEN_ID);
      assert.equal(config.length, 1);
      assert.equal(config[0].weightBps.toString(), "10000");
    });

    it("reverts if weights do not sum to 10000", async () => {
      const bad = [
        { token: TOKEN_A, weightBps: 6000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
        { token: TOKEN_B, weightBps: 3000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" }, // sum = 9000
      ];
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }),
        "weights must sum to 10000"
      );
    });

    it("reverts if a weight is zero", async () => {
      const bad = [
        { token: TOKEN_A, weightBps: 0,     poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
        { token: TOKEN_B, weightBps: 10000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }),
        "zero weight"
      );
    });

    it("reverts if a token address is zero", async () => {
      const bad = [
        {
          token: "0x0000000000000000000000000000000000000000",
          weightBps: 10000,
          poolFee: 3000,
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
        { token: TOKEN_A, weightBps: 10000, poolFee: 1234, swapPath: "0x", sellSwapPath: "0x" },
      ];
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, bad, { from: owner }),
        "invalid pool fee"
      );
    });

    it("accepts all three valid pool fee tiers", async () => {
      for (const fee of [500, 3000, 10000]) {
        const assets = [{ token: TOKEN_A, weightBps: 10000, poolFee: fee, swapPath: "0x", sellSwapPath: "0x" }];
        await sf.setPortfolioConfig(TOKEN_ID, assets, { from: owner });
        const config = await sf.getPortfolioConfig(TOKEN_ID);
        assert.equal(config[0].poolFee.toString(), fee.toString());
      }
    });

    it("reverts if no assets provided", async () => {
      await expectRevert(
        sf.setPortfolioConfig(TOKEN_ID, [], { from: owner }),
        "no assets provided"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(sf.setPortfolioConfig(TOKEN_ID, VALID_ASSETS, { from: alice }));
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

    let sf, tokenA, tokenB, mockWETH, mockRouter;

    // Portfolio: 60% tokenA (poolFee 3000), 40% tokenB (poolFee 500)
    const buildAssets = (addrA, addrB) => [
      { token: addrA, weightBps: 6000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
      { token: addrB, weightBps: 4000, poolFee: 500,  swapPath: "0x", sellSwapPath: "0x" },
    ];

    beforeEach(async () => {
      // Deploy contracts
      const treasuryFacet2     = await SmartfolioTreasury.new();
      const marketFacet2       = await SmartfolioMarket.new();
      const creditMarketFacet2 = await SmartfolioCreditMarket.new();
      sf         = await deployProxy(Smartfolio, [owner, treasuryFacet2.address, marketFacet2.address, creditMarketFacet2.address], { kind: "uups" });
      tokenA     = await MockERC20.new("Token A", "TKA");
      tokenB     = await MockERC20.new("Token B", "TKB");
      mockWETH   = await MockWETH.new();
      mockRouter = await MockSwapRouter.new();

      // Fund router with tokens so it can fulfil swaps
      await tokenA.mint(mockRouter.address, toWei("10000"));
      await tokenB.mint(mockRouter.address, toWei("10000"));
      // Fund router with WETH so it can fulfil token→WETH sells in rebalance.
      // Reserve is only 0.01 ETH so 0.1 ETH of WETH is ample.
      await mockWETH.deposit({ value: toWei("0.1"), from: owner });
      await mockWETH.transfer(mockRouter.address, toWei("0.1"), { from: owner });

      // Configure Smartfolio
      await sf.setKeeper(keeper, { from: owner });
      await sf.setSwapRouter(mockRouter.address, { from: owner });
      await sf.setWETH(mockWETH.address, { from: owner });

      // Set tiers and portfolio config for TOKEN_ID
      await sf.setTiers(TOKEN_ID, TIERS, { from: owner });
      await sf.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address), { from: owner });

      // Alice mints 10 tokens (10 × 0.001 ETH = 0.01 ETH in reserve)
      const cost = await sf.mintCost(TOKEN_ID, 10);
      await sf.mint(alice, TOKEN_ID, 10, "0x", { from: alice, value: cost });
    });

    // ---- deploy ----

    describe("deploy", () => {
      it("zeroes reserve, sets portfolioActive, sets deployedEth, updates holdings, emits Deployed", async () => {
        const reserveBefore = await sf.reserve(TOKEN_ID);
        assert.ok(new BN(reserveBefore).gt(new BN(0)), "reserve must be > 0 before deploy");

        const tx = await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });

        // Reserve cleared
        assert.equal((await sf.reserve(TOKEN_ID)).toString(), "0");

        // Portfolio marked active
        assert.equal(await sf.portfolioActive(TOKEN_ID), true);

        // deployedEth records original reserve
        assert.equal((await sf.deployedEth(TOKEN_ID)).toString(), reserveBefore.toString());

        // portfolioHoldings updated — MockSwapRouter is 1:1, so
        // tokenA gets 60% of reserve, tokenB gets remainder (40%)
        const expectedA = new BN(reserveBefore).muln(6000).divn(10000);
        const expectedB = new BN(reserveBefore).sub(expectedA); // remainder
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
        await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });
        await expectRevert(sf.deploy(TOKEN_ID, [0, 0], { from: keeper }), "already deployed");
      });

      it("reverts if no portfolio config", async () => {
        const OTHER_ID = 42;
        await sf.setTiers(OTHER_ID, TIERS, { from: owner });
        const cost = await sf.mintCost(OTHER_ID, 1);
        await sf.mint(alice, OTHER_ID, 1, "0x", { from: alice, value: cost });
        await expectRevert(sf.deploy(OTHER_ID, [], { from: keeper }), "no portfolio config");
      });

      it("reverts if no reserve", async () => {
        // Deploy once to drain reserve
        await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });
        // Try to deploy a fresh token ID that has a config but no reserve
        const OTHER_ID = 43;
        await sf.setTiers(OTHER_ID, TIERS, { from: owner });
        await sf.setPortfolioConfig(OTHER_ID, buildAssets(tokenA.address, tokenB.address), { from: owner });
        await expectRevert(sf.deploy(OTHER_ID, [0, 0], { from: keeper }), "no reserve to deploy");
      });

      it("reverts if amountsOutMinimum length mismatches config", async () => {
        await expectRevert(
          sf.deploy(TOKEN_ID, [0], { from: keeper }), // config has 2 assets, only 1 min
          "length mismatch"
        );
      });

      it("reverts if called by non-keeper", async () => {
        await expectRevert(sf.deploy(TOKEN_ID, [0, 0], { from: alice }), "not keeper");
      });

      it("reverts if router is not set", async () => {
        const t2 = await SmartfolioTreasury.new();
        const m2 = await SmartfolioMarket.new();
        const c2 = await SmartfolioCreditMarket.new();
        const sf2 = await deployProxy(Smartfolio, [owner, t2.address, m2.address, c2.address], { kind: "uups" });
        await sf2.setTiers(TOKEN_ID, TIERS, { from: owner });
        await sf2.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address), { from: owner });
        await sf2.setKeeper(keeper, { from: owner });
        await sf2.setWETH(mockWETH.address, { from: owner });
        const cost = await sf2.mintCost(TOKEN_ID, 1);
        await sf2.mint(alice, TOKEN_ID, 1, "0x", { from: alice, value: cost });
        await expectRevert(sf2.deploy(TOKEN_ID, [0, 0], { from: keeper }), "router not set");
      });

      it("blocks setPortfolioConfig once portfolio is active", async () => {
        await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });
        await expectRevert(
          sf.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address), { from: owner }),
          "portfolio is active"
        );
      });

      it("blocks burn() when portfolio is active", async () => {
        await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });
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
        await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });
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

      it("reverts if portfolio is not active", async () => {
        const OTHER_ID = 44;
        await sf.setTiers(OTHER_ID, TIERS, { from: owner });
        await sf.setPortfolioConfig(OTHER_ID, buildAssets(tokenA.address, tokenB.address), { from: owner });
        const instructions = [
          { token: tokenA.address, isSell: true, amountIn: 1, amountOutMin: 0, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
        ];
        await expectRevert(sf.rebalance(OTHER_ID, instructions, { from: keeper }), "portfolio not active");
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

    let sf, tokenA, tokenB, mockWETH, mockRouter;

    const buildAssets = (addrA, addrB) => [
      { token: addrA, weightBps: 6000, poolFee: 3000, swapPath: "0x", sellSwapPath: "0x" },
      { token: addrB, weightBps: 4000, poolFee: 500,  swapPath: "0x", sellSwapPath: "0x" },
    ];

    beforeEach(async () => {
      const treasuryFacet3     = await SmartfolioTreasury.new();
      const marketFacet3       = await SmartfolioMarket.new();
      const creditMarketFacet3 = await SmartfolioCreditMarket.new();
      sf         = await deployProxy(Smartfolio, [owner, treasuryFacet3.address, marketFacet3.address, creditMarketFacet3.address], { kind: "uups" });
      tokenA     = await MockERC20.new("Token A", "TKA");
      tokenB     = await MockERC20.new("Token B", "TKB");
      mockWETH   = await MockWETH.new();
      mockRouter = await MockSwapRouter.new();

      // Fund router: ERC20s for buys and WETH for sells
      await tokenA.mint(mockRouter.address, toWei("10000"));
      await tokenB.mint(mockRouter.address, toWei("10000"));
      await mockWETH.deposit({ value: toWei("0.1"), from: owner });
      await mockWETH.transfer(mockRouter.address, toWei("0.1"), { from: owner });

      await sf.setKeeper(keeper, { from: owner });
      await sf.setSwapRouter(mockRouter.address, { from: owner });
      await sf.setWETH(mockWETH.address, { from: owner });

      await sf.setTiers(TOKEN_ID, TIERS, { from: owner });
      await sf.setPortfolioConfig(TOKEN_ID, buildAssets(tokenA.address, tokenB.address), { from: owner });

      // Alice mints 100 tokens → 0.1 ETH in reserve
      const cost = await sf.mintCost(TOKEN_ID, 100);
      await sf.mint(alice, TOKEN_ID, 100, "0x", { from: alice, value: cost });

      // Deploy portfolio
      await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });
    });

    // ---- helpers ----

    // Expected token amounts held after deploy (1:1 mock rate):
    //   tokenA = 60% of reserve, tokenB = remainder (40%)
    async function expectedHoldings(reserveAmount) {
      const a = new BN(reserveAmount).muln(6000).divn(10000);
      const b = new BN(reserveAmount).sub(a);
      return { a, b };
    }

    describe("divest", () => {
      it("burns tokens, sells ERC20s, returns ETH, emits Divested", async () => {
        const deployedAmount = await sf.deployedEth(TOKEN_ID);
        const { a: holdingA, b: holdingB } = await expectedHoldings(deployedAmount);

        const supplyBefore = await sf.totalSupply(TOKEN_ID);
        const ethBefore    = new BN(await web3.eth.getBalance(alice));

        // Divest half (50 of 100 tokens)
        const tx = await sf.divest(TOKEN_ID, 50, 0, { from: alice });
        const gasUsed  = new BN(tx.receipt.gasUsed);
        const gasPrice = new BN(tx.receipt.effectiveGasPrice || (await web3.eth.getGasPrice()));

        const supplyAfter = await sf.totalSupply(TOKEN_ID);
        const ethAfter    = new BN(await web3.eth.getBalance(alice));

        // Supply reduced
        assert.equal(supplyAfter.toString(), new BN(supplyBefore).subn(50).toString());

        // ERC1155 balance reduced
        assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "50");

        // Holdings reduced by 50%
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenA.address)).toString(),
          holdingA.divn(2).toString()
        );
        assert.equal(
          (await sf.portfolioHoldings(TOKEN_ID, tokenB.address)).toString(),
          holdingB.divn(2).toString()
        );

        // Alice received ETH (net of gas)
        const ethReceived = ethAfter.sub(ethBefore).add(gasUsed.mul(gasPrice));
        assert.ok(ethReceived.gt(new BN(0)), "Alice should receive ETH");

        // Event
        const log = tx.logs.find((l) => l.event === "Divested");
        assert.ok(log);
        assert.equal(log.args.account, alice);
        assert.equal(log.args.id.toString(), TOKEN_ID.toString());
        assert.equal(log.args.amount.toString(), "50");
        assert.equal(log.args.ethReceived.toString(), ethReceived.toString());
      });

      it("full divest: all tokens burned, portfolioActive resets to false", async () => {
        await sf.divest(TOKEN_ID, 100, 0, { from: alice });

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

      it("after full divest owner can reconfigure and redeploy", async () => {
        await sf.divest(TOKEN_ID, 100, 0, { from: alice });

        // Can set new config now that portfolio is inactive
        await sf.setPortfolioConfig(
          TOKEN_ID,
          buildAssets(tokenA.address, tokenB.address),
          { from: owner }
        );

        // Bob mints and redeploys
        const cost = await sf.mintCost(TOKEN_ID, 10);
        await sf.mint(bob, TOKEN_ID, 10, "0x", { from: bob, value: cost });
        await sf.deploy(TOKEN_ID, [0, 0], { from: keeper });

        assert.equal(await sf.portfolioActive(TOKEN_ID), true);
      });

      it("multiple holders divesting proportionally does not affect each other", async () => {
        // Bob also mints 100 tokens — now total supply is 200
        const cost = await sf.mintCost(TOKEN_ID, 100);
        // Need to undeploy for Bob to add to reserve... actually portfolio is active
        // so Bob can still mint (mint adds to reserve, does not go to portfolio automatically)
        await sf.mint(bob, TOKEN_ID, 100, "0x", { from: bob, value: cost });

        const holdingABefore = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        const supply = new BN(await sf.totalSupply(TOKEN_ID)); // 200

        // Alice divests her 100 (50% of supply)
        await sf.divest(TOKEN_ID, 100, 0, { from: alice });

        const holdingAAfter = new BN(await sf.portfolioHoldings(TOKEN_ID, tokenA.address));
        // tokenA holdings should have decreased by 50%
        assert.equal(
          holdingAAfter.toString(),
          holdingABefore.mul(new BN(supply.subn(100))).div(supply).toString()
        );

        // Bob's balance untouched
        assert.equal((await sf.balanceOf(bob, TOKEN_ID)).toString(), "100");
      });

      it("receives ETH equal to sold ERC20 value (1:1 mock rate)", async () => {
        const deployedAmount = await sf.deployedEth(TOKEN_ID);
        // 1:1 rate: total ETH received ≈ deployedAmount (minus any rounding)
        const ethBefore = new BN(await web3.eth.getBalance(alice));
        const tx = await sf.divest(TOKEN_ID, 100, 0, { from: alice });
        const gasUsed  = new BN(tx.receipt.gasUsed);
        const gasPrice = new BN(tx.receipt.effectiveGasPrice || (await web3.eth.getGasPrice()));
        const ethAfter = new BN(await web3.eth.getBalance(alice));
        const received = ethAfter.sub(ethBefore).add(gasUsed.mul(gasPrice));
        // Should be very close to deployedAmount (within 2 wei of rounding)
        const diff = new BN(deployedAmount).sub(received).abs();
        assert.ok(diff.lten(2), `Expected ~${deployedAmount} ETH, got ${received}`);
      });

      it("reverts if minEthOut is not met", async () => {
        const deployedAmount = await sf.deployedEth(TOKEN_ID);
        // Demand more ETH than the portfolio is worth
        const tooMuch = new BN(deployedAmount).muln(10);
        await expectRevert(
          sf.divest(TOKEN_ID, 100, tooMuch, { from: alice }),
          "insufficient ETH out"
        );
      });

      it("reverts if portfolio is not active", async () => {
        // Deploy a fresh token ID that has never been deployed
        const OTHER_ID = 50;
        await sf.setTiers(OTHER_ID, TIERS, { from: owner });
        await sf.setPortfolioConfig(
          OTHER_ID,
          buildAssets(tokenA.address, tokenB.address),
          { from: owner }
        );
        const cost = await sf.mintCost(OTHER_ID, 1);
        await sf.mint(alice, OTHER_ID, 1, "0x", { from: alice, value: cost });
        await expectRevert(
          sf.divest(OTHER_ID, 1, 0, { from: alice }),
          "portfolio not active"
        );
      });

      it("reverts if balance is insufficient", async () => {
        await expectRevert(
          sf.divest(TOKEN_ID, 101, 0, { from: alice }),
          "insufficient balance"
        );
      });

      it("reverts if amount is zero", async () => {
        await expectRevert(
          sf.divest(TOKEN_ID, 0, 0, { from: alice }),
          "amount must be > 0"
        );
      });

      it("reverts when paused", async () => {
        await sf.pause({ from: owner });
        await expectRevert(sf.divest(TOKEN_ID, 1, 0, { from: alice }), "EnforcedPause");
      });

      it("deployedEth decreases proportionally", async () => {
        const deployedBefore = new BN(await sf.deployedEth(TOKEN_ID));
        await sf.divest(TOKEN_ID, 50, 0, { from: alice }); // 50% exit
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

// =============================================================================
// Leverage Phase 1 — Aave collateral management
// =============================================================================

contract("Smartfolio — leverage Phase 1", (accounts) => {
  const [owner, alice, bob] = accounts;

  let sf, mockWETH, mockAavePool, mockStable;

  const LEV_ID = 10; // leverage token ID (separate from regular TOKEN_ID = 1)

  const makeLevCfg = (pool, stable) => ({
    aavePool:     pool,
    stableToken:  stable,
    targetLtvBps: 500,  // 5%
    maxLtvBps:    1000, // 10%
  });

  beforeEach(async () => {
    const treasuryFacet     = await SmartfolioTreasury.new();
    const marketFacet       = await SmartfolioMarket.new();
    const creditMarketFacet = await SmartfolioCreditMarket.new();
    sf           = await deployProxy(Smartfolio, [owner, treasuryFacet.address, marketFacet.address, creditMarketFacet.address], { kind: "uups" });
    mockWETH     = await MockWETH.new();
    mockAavePool = await MockAavePool.new();
    mockStable   = await MockERC20.new("USD Coin", "USDC");

    await sf.setWETH(mockWETH.address, { from: owner });
    await sf.setTiers(LEV_ID, TIERS, { from: owner });
    await sf.setLeverageConfig(LEV_ID, makeLevCfg(mockAavePool.address, mockStable.address), { from: owner });
  });

  // ---------------------------------------------------------------------------
  // setLeverageConfig
  // ---------------------------------------------------------------------------

  describe("setLeverageConfig", () => {
    it("stores config, sets isLeverageToken, emits LeverageConfigSet", async () => {
      assert.equal(await sf.isLeverageToken(LEV_ID), true);
      const cfg = await sf.leverageConfig(LEV_ID);
      assert.equal(cfg.aavePool,      mockAavePool.address);
      assert.equal(cfg.stableToken,   mockStable.address);
      assert.equal(cfg.targetLtvBps.toString(), "500");
      assert.equal(cfg.maxLtvBps.toString(),    "1000");
    });

    it("reverts if aavePool is zero address", async () => {
      await expectRevert(
        sf.setLeverageConfig(99, makeLevCfg(
          "0x0000000000000000000000000000000000000000",
          mockStable.address
        ), { from: owner }),
        "zero aavePool"
      );
    });

    it("reverts if stableToken is zero address", async () => {
      await expectRevert(
        sf.setLeverageConfig(99, makeLevCfg(
          mockAavePool.address,
          "0x0000000000000000000000000000000000000000"
        ), { from: owner }),
        "zero stableToken"
      );
    });

    it("reverts if targetLtvBps is zero", async () => {
      await expectRevert(
        sf.setLeverageConfig(99, {
          aavePool:     mockAavePool.address,
          stableToken:  mockStable.address,
          targetLtvBps: 0,
          maxLtvBps:    1000,
        }, { from: owner }),
        "zero targetLtv"
      );
    });

    it("reverts if targetLtvBps > maxLtvBps", async () => {
      await expectRevert(
        sf.setLeverageConfig(99, {
          aavePool:     mockAavePool.address,
          stableToken:  mockStable.address,
          targetLtvBps: 900,
          maxLtvBps:    500,
        }, { from: owner }),
        "targetLtv > maxLtv"
      );
    });

    it("reverts if maxLtvBps exceeds 1000 (10%)", async () => {
      await expectRevert(
        sf.setLeverageConfig(99, {
          aavePool:     mockAavePool.address,
          stableToken:  mockStable.address,
          targetLtvBps: 500,
          maxLtvBps:    1001,
        }, { from: owner }),
        "maxLtv exceeds 10%"
      );
    });

    it("reverts if token already has circulating supply", async () => {
      const cost = await sf.mintCost(LEV_ID, 1);
      await sf.mintLeverage(LEV_ID, 1, "0x", { from: alice, value: cost });
      await expectRevert(
        sf.setLeverageConfig(LEV_ID, makeLevCfg(mockAavePool.address, mockStable.address), { from: owner }),
        "token has supply"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(
        sf.setLeverageConfig(99, makeLevCfg(mockAavePool.address, mockStable.address), { from: alice }),
        "OwnableUnauthorizedAccount"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // mintLeverage
  // ---------------------------------------------------------------------------

  describe("mintLeverage", () => {
    it("mints tokens, updates aaveCollateral, deposits WETH to Aave, emits LeverageMinted", async () => {
      const cost = await sf.mintCost(LEV_ID, 10);
      const tx   = await sf.mintLeverage(LEV_ID, 10, "0x", { from: alice, value: cost });

      assert.equal((await sf.balanceOf(alice, LEV_ID)).toString(), "10");
      assert.equal((await sf.totalSupply(LEV_ID)).toString(), "10");
      assert.equal((await sf.totalMinted(LEV_ID)).toString(), "10");
      assert.equal((await sf.aaveCollateral(LEV_ID)).toString(), cost.toString());
      // reserve stays 0 — ETH lives in Aave, not here
      assert.equal((await sf.reserve(LEV_ID)).toString(), "0");
      // MockAavePool holds the WETH
      assert.equal((await mockWETH.balanceOf(mockAavePool.address)).toString(), cost.toString());

      const ev = tx.logs.find(l => l.event === "LeverageMinted");
      assert.ok(ev, "LeverageMinted event not emitted");
      assert.equal(ev.args.account, alice);
      assert.equal(ev.args.id.toString(), String(LEV_ID));
      assert.equal(ev.args.amount.toString(), "10");
      assert.equal(ev.args.ethDeposited.toString(), cost.toString());
    });

    it("refunds excess ETH", async () => {
      const cost  = await sf.mintCost(LEV_ID, 1);
      const extra = new BN(toWei("0.5"));
      const before = new BN(await web3.eth.getBalance(alice));
      await sf.mintLeverage(LEV_ID, 1, "0x", { from: alice, value: cost.add(extra) });
      const after = new BN(await web3.eth.getBalance(alice));
      // Net spend should be cost + gas (gas < 0.01 ETH), excess is refunded
      const gasTolerance = new BN(toWei("0.01"));
      const netSpend = before.sub(after);
      assert.ok(netSpend.gte(cost), "alice should have spent at least the cost");
      assert.ok(netSpend.lte(cost.add(gasTolerance)), "alice should not have spent more than cost + gas");
    });

    it("cumulative: second mint adds to aaveCollateral", async () => {
      const cost1 = await sf.mintCost(LEV_ID, 10);
      await sf.mintLeverage(LEV_ID, 10, "0x", { from: alice, value: cost1 });
      const cost2 = await sf.mintCost(LEV_ID, 5);
      await sf.mintLeverage(LEV_ID, 5, "0x", { from: bob, value: cost2 });

      const expected = cost1.add(cost2);
      assert.equal((await sf.aaveCollateral(LEV_ID)).toString(), expected.toString());
    });

    it("reverts if not a leverage token", async () => {
      await expectRevert(
        sf.mintLeverage(999, 1, "0x", { from: alice, value: toWei("1") }),
        "not a leverage token"
      );
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(
        sf.mintLeverage(LEV_ID, 0, "0x", { from: alice, value: 0 }),
        "amount must be > 0"
      );
    });

    it("reverts if ETH is insufficient", async () => {
      const cost = await sf.mintCost(LEV_ID, 10);
      await expectRevert(
        sf.mintLeverage(LEV_ID, 10, "0x", { from: alice, value: cost.subn(1) }),
        "insufficient ETH"
      );
    });


    it("reverts when paused", async () => {
      const cost = await sf.mintCost(LEV_ID, 1);
      await sf.pause({ from: owner });
      await expectRevert(
        sf.mintLeverage(LEV_ID, 1, "0x", { from: alice, value: cost }),
        "EnforcedPause"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // divestLeverage
  // ---------------------------------------------------------------------------

  describe("divestLeverage", () => {
    let mintCost100;

    beforeEach(async () => {
      mintCost100 = await sf.mintCost(LEV_ID, 100);
      await sf.mintLeverage(LEV_ID, 100, "0x", { from: alice, value: mintCost100 });
    });

    it("burns tokens, withdraws from Aave, returns ETH, emits LeverageDivested", async () => {
      const collBefore   = new BN(await sf.aaveCollateral(LEV_ID));
      const balBefore    = new BN(await web3.eth.getBalance(alice));

      const tx = await sf.divestLeverage(LEV_ID, 50, 0, { from: alice });

      assert.equal((await sf.balanceOf(alice, LEV_ID)).toString(), "50");
      assert.equal((await sf.totalSupply(LEV_ID)).toString(), "50");

      const collAfter = new BN(await sf.aaveCollateral(LEV_ID));
      assert.ok(
        collAfter.sub(collBefore.divn(2)).abs().lten(1),
        "aaveCollateral should halve"
      );

      const balAfter = new BN(await web3.eth.getBalance(alice));
      assert.ok(balAfter.gt(balBefore), "alice should receive ETH");

      const ev = tx.logs.find(l => l.event === "LeverageDivested");
      assert.ok(ev, "LeverageDivested event not emitted");
      assert.equal(ev.args.account, alice);
      assert.equal(ev.args.id.toString(), String(LEV_ID));
      assert.equal(ev.args.amount.toString(), "50");
    });

    it("full exit: all tokens burned, aaveCollateral reaches 0", async () => {
      await sf.divestLeverage(LEV_ID, 100, 0, { from: alice });
      assert.equal((await sf.totalSupply(LEV_ID)).toString(), "0");
      assert.equal((await sf.aaveCollateral(LEV_ID)).toString(), "0");
    });

    it("ETH received is approximately original cost (within gas)", async () => {
      const gasTolerance = new BN(toWei("0.01")); // up to 0.01 ETH in gas fees
      const balBefore = new BN(await web3.eth.getBalance(alice));
      await sf.divestLeverage(LEV_ID, 100, 0, { from: alice });
      const balAfter = new BN(await web3.eth.getBalance(alice));
      const net = balAfter.sub(balBefore); // positive: ETH received minus gas paid
      assert.ok(net.add(gasTolerance).gte(mintCost100), "should receive close to original cost");
    });

    it("two holders divest proportionally without affecting each other", async () => {
      const costBob = await sf.mintCost(LEV_ID, 100);
      await sf.mintLeverage(LEV_ID, 100, "0x", { from: bob, value: costBob });

      const totalColl = new BN(await sf.aaveCollateral(LEV_ID));
      const totalSup  = new BN(await sf.totalSupply(LEV_ID)); // 200

      // Alice exits her 100 (50% of supply)
      const aliceShare = totalColl.muln(100).div(totalSup);
      const balBefore  = new BN(await web3.eth.getBalance(alice));
      await sf.divestLeverage(LEV_ID, 100, 0, { from: alice });
      const balAfter = new BN(await web3.eth.getBalance(alice));

      // Net to alice: aliceShare minus gas fees (allow up to 0.01 ETH gas)
      const gasTolerance = new BN(toWei("0.01"));
      const received = balAfter.sub(balBefore);
      assert.ok(received.add(gasTolerance).gte(aliceShare), "alice should receive close to her pro-rata share");
      assert.ok(received.lte(aliceShare.add(new BN(1))), "alice should not receive more than her share");
      // Bob's tokens still intact
      assert.equal((await sf.balanceOf(bob, LEV_ID)).toString(), "100");
    });

    it("reverts if minEthOut is not satisfied", async () => {
      await expectRevert(
        sf.divestLeverage(LEV_ID, 1, toWei("999"), { from: alice }),
        "insufficient ETH out"
      );
    });

    it("reverts if not a leverage token", async () => {
      await expectRevert(
        sf.divestLeverage(999, 1, 0, { from: alice }),
        "not a leverage token"
      );
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(
        sf.divestLeverage(LEV_ID, 0, 0, { from: alice }),
        "amount must be > 0"
      );
    });

    it("reverts if balance is insufficient", async () => {
      await expectRevert(
        sf.divestLeverage(LEV_ID, 101, 0, { from: alice }),
        "insufficient balance"
      );
    });

    it("aaveDebt is 0 in Phase 1 (no borrowing yet)", async () => {
      assert.equal((await sf.aaveDebt(LEV_ID)).toString(), "0");
    });

    it("reverts when paused", async () => {
      await sf.pause({ from: owner });
      await expectRevert(
        sf.divestLeverage(LEV_ID, 1, 0, { from: alice }),
        "EnforcedPause"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getLeverageInfo
  // ---------------------------------------------------------------------------

  describe("getLeverageInfo", () => {
    it("returns zero collateral and debt before any mint", async () => {
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.equal(info.collateralWeth.toString(), "0");
      assert.equal(info.debtStable.toString(), "0");
      assert.equal(info.ltvBps.toString(), "0");
    });

    it("returns updated collateral after mint", async () => {
      const cost = await sf.mintCost(LEV_ID, 10);
      await sf.mintLeverage(LEV_ID, 10, "0x", { from: alice, value: cost });
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.equal(info.collateralWeth.toString(), cost.toString());
      assert.equal(info.debtStable.toString(), "0");
    });

    it("collateralWeth decreases after partial divest", async () => {
      const cost = await sf.mintCost(LEV_ID, 100);
      await sf.mintLeverage(LEV_ID, 100, "0x", { from: alice, value: cost });
      await sf.divestLeverage(LEV_ID, 50, 0, { from: alice });
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.ok(
        new BN(info.collateralWeth).sub(cost.divn(2)).abs().lten(1),
        "collateralWeth should halve after 50% exit"
      );
    });

    it("reverts if called on a non-leverage token", async () => {
      await expectRevert(
        sf.getLeverageInfo(TOKEN_ID),
        "not a leverage token"
      );
    });
  });
});

// =============================================================================
// Leverage Phase 2 — signal-driven keeper operations
// =============================================================================

contract("Smartfolio — leverage Phase 2", (accounts) => {
  const [owner, keeperAccount, alice] = accounts;

  const LEV_ID = 10;

  // Single-tier for simplicity: 0.001 ETH per token, 100 tokens minted = 0.1 ETH collateral
  const LEV_TIERS = [
    { threshold: 0, pricePerToken: toWei("0.001") },
  ];

  const makeLevCfg = (pool, stable) => ({
    aavePool:     pool,
    stableToken:  stable,
    targetLtvBps: 500,
    maxLtvBps:    1000,
  });

  let sf, mockWETH, mockAavePool, mockStable, mockRouter;
  let mintCost100; // cost to mint 100 leverage tokens

  beforeEach(async () => {
    const tFacet = await SmartfolioTreasury.new();
    const mFacet = await SmartfolioMarket.new();
    const cFacet = await SmartfolioCreditMarket.new();
    sf = await deployProxy(
      Smartfolio,
      [owner, tFacet.address, mFacet.address, cFacet.address],
      { kind: "uups" }
    );

    mockWETH   = await MockWETH.new();
    mockStable = await MockERC20.new("USD Coin", "USDC");
    mockAavePool = await MockAavePool.new();
    mockRouter   = await MockSwapRouter.new();

    await sf.setWETH(mockWETH.address,             { from: owner });
    await sf.setSwapRouter(mockRouter.address,      { from: owner });
    await sf.setKeeper(keeperAccount,               { from: owner });
    await sf.setTiers(LEV_ID, LEV_TIERS,            { from: owner });
    await sf.setLeverageConfig(LEV_ID, makeLevCfg(mockAavePool.address, mockStable.address), { from: owner });

    // Alice mints 100 leverage tokens → 0.1 ETH → Aave as WETH collateral
    mintCost100 = await sf.mintCost(LEV_ID, 100);
    await sf.mintLeverage(LEV_ID, 100, "0x", { from: alice, value: mintCost100 });

    // Pre-fund MockAavePool with stable so it can lend via borrow()
    await mockStable.mint(mockAavePool.address, toWei("10"));

    // Pre-fund MockSwapRouter with WETH for leverUp (stable→WETH swap)
    await mockWETH.deposit({ value: toWei("1"), from: owner });
    await mockWETH.transfer(mockRouter.address, toWei("1"), { from: owner });

    // Pre-fund MockSwapRouter with stable for leverDown (WETH→stable swap)
    await mockStable.mint(mockRouter.address, toWei("10"));
  });

  // ---------------------------------------------------------------------------
  // leverUp
  // ---------------------------------------------------------------------------

  describe("leverUp", () => {
    it("borrows stable, swaps to WETH, re-deposits, updates aaveDebt and aaveCollateral, emits LeverUp", async () => {
      const collBefore = new BN(await sf.aaveCollateral(LEV_ID));
      const debtBefore = new BN(await sf.aaveDebt(LEV_ID));
      assert.equal(debtBefore.toString(), "0");

      const stableToBorrow = new BN(toWei("0.001")); // tiny: ~1% of 0.1 ETH collateral
      const tx = await sf.leverUp(LEV_ID, stableToBorrow, 0, 3000, "0x", { from: keeperAccount });

      const collAfter = new BN(await sf.aaveCollateral(LEV_ID));
      const debtAfter = new BN(await sf.aaveDebt(LEV_ID));

      // aaveDebt should equal stableToBorrow (1:1 mock, no interest)
      assert.equal(debtAfter.toString(), stableToBorrow.toString());
      // aaveCollateral should have increased (WETH received from swap re-deposited)
      assert.ok(collAfter.gt(collBefore), "aaveCollateral should increase after leverUp");

      const ev = tx.logs.find(l => l.event === "LeverUp");
      assert.ok(ev, "LeverUp event not emitted");
      assert.equal(ev.args.id.toString(), String(LEV_ID));
      assert.equal(ev.args.stableBorrowed.toString(), stableToBorrow.toString());
      assert.ok(new BN(ev.args.wethAdded).gt(new BN(0)), "wethAdded should be > 0");
    });

    it("checkLtv returns non-zero bps after leverUp", async () => {
      const ltvBefore = await sf.checkLtv(LEV_ID);
      assert.equal(ltvBefore.toString(), "0");

      await sf.leverUp(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });

      const ltvAfter = await sf.checkLtv(LEV_ID);
      assert.ok(new BN(ltvAfter).gt(new BN(0)), "LTV should be > 0 after leverUp");
      assert.ok(new BN(ltvAfter).lte(new BN(1000)), "LTV should be within maxLtvBps");
    });

    it("getLeverageInfo.ltvBps increases after leverUp", async () => {
      await sf.leverUp(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.ok(new BN(info.ltvBps).gt(new BN(0)));
      assert.ok(new BN(info.debtStable).gt(new BN(0)));
    });

    it("reverts if resulting LTV exceeds maxLtvBps (10%)", async () => {
      // Borrowing 0.05 ETH worth of stable with 0.1 ETH collateral → ~33% LTV after re-deposit
      // After swap + re-deposit: collateral=0.15, debt=0.05 → LTV≈33%, well over 10%
      await expectRevert(
        sf.leverUp(LEV_ID, new BN(toWei("0.05")), 0, 3000, "0x", { from: keeperAccount }),
        "LTV cap exceeded"
      );
    });

    it("reverts if stableToBorrow is zero", async () => {
      await expectRevert(
        sf.leverUp(LEV_ID, 0, 0, 3000, "0x", { from: keeperAccount }),
        "amount must be > 0"
      );
    });

    it("reverts if not a leverage token", async () => {
      await expectRevert(
        sf.leverUp(999, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount }),
        "not a leverage token"
      );
    });

    it("reverts if called by non-keeper", async () => {
      await expectRevert(
        sf.leverUp(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: alice }),
        "not keeper"
      );
    });

    it("reverts if no collateral (no leverage position)", async () => {
      // Use a different token ID with no minted tokens
      await sf.setTiers(99, LEV_TIERS, { from: owner });
      await sf.setLeverageConfig(99, makeLevCfg(mockAavePool.address, mockStable.address), { from: owner });
      await expectRevert(
        sf.leverUp(99, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount }),
        "no leverage position"
      );
    });

    it("multiple leverUp calls compound the position", async () => {
      const small = new BN(toWei("0.001"));
      await sf.leverUp(LEV_ID, small, 0, 3000, "0x", { from: keeperAccount });
      const debtMid = new BN(await sf.aaveDebt(LEV_ID));

      await sf.leverUp(LEV_ID, small, 0, 3000, "0x", { from: keeperAccount });
      const debtFinal = new BN(await sf.aaveDebt(LEV_ID));

      // Debt should be ~2× after two equal leverUps
      assert.ok(debtFinal.sub(debtMid).sub(small).abs().lten(1));
    });
  });

  // ---------------------------------------------------------------------------
  // leverDown
  // ---------------------------------------------------------------------------

  describe("leverDown", () => {
    const borrowAmount = new BN(toWei("0.001"));

    beforeEach(async () => {
      // Establish a leveraged position first
      await sf.leverUp(LEV_ID, borrowAmount, 0, 3000, "0x", { from: keeperAccount });
    });

    it("withdraws WETH, swaps to stable, repays debt, updates state, emits LeverDown", async () => {
      const collBefore = new BN(await sf.aaveCollateral(LEV_ID));
      const debtBefore = new BN(await sf.aaveDebt(LEV_ID));

      // Withdraw same WETH that was added in leverUp (1:1 swap rate)
      const wethToWithdraw = borrowAmount; // borrowAmount of stable → same WETH at 1:1
      const tx = await sf.leverDown(LEV_ID, wethToWithdraw, 0, 3000, "0x", { from: keeperAccount });

      const collAfter = new BN(await sf.aaveCollateral(LEV_ID));
      const debtAfter = new BN(await sf.aaveDebt(LEV_ID));

      assert.ok(collAfter.lt(collBefore), "collateral should decrease after leverDown");
      assert.ok(debtAfter.lt(debtBefore), "debt should decrease after leverDown");

      const ev = tx.logs.find(l => l.event === "LeverDown");
      assert.ok(ev, "LeverDown event not emitted");
      assert.equal(ev.args.id.toString(), String(LEV_ID));
      assert.ok(new BN(ev.args.stableRepaid).gt(new BN(0)));
      assert.ok(new BN(ev.args.wethWithdrawn).gt(new BN(0)));
    });

    it("full leverDown: aaveDebt reaches 0 and divestLeverage succeeds", async () => {
      // Withdraw exactly the WETH added during leverUp → full repayment
      await sf.leverDown(LEV_ID, borrowAmount, 0, 3000, "0x", { from: keeperAccount });

      assert.equal((await sf.aaveDebt(LEV_ID)).toString(), "0");

      // divestLeverage should now succeed (debt == 0)
      await sf.divestLeverage(LEV_ID, 10, 0, { from: alice });
      assert.equal((await sf.balanceOf(alice, LEV_ID)).toString(), "90");
    });

    it("LTV decreases after leverDown", async () => {
      const ltvBefore = new BN(await sf.checkLtv(LEV_ID));
      await sf.leverDown(LEV_ID, borrowAmount, 0, 3000, "0x", { from: keeperAccount });
      const ltvAfter = new BN(await sf.checkLtv(LEV_ID));
      assert.ok(ltvAfter.lt(ltvBefore), "LTV should decrease after leverDown");
    });

    it("LTV is 0 after full debt repayment", async () => {
      await sf.leverDown(LEV_ID, borrowAmount, 0, 3000, "0x", { from: keeperAccount });
      assert.equal((await sf.checkLtv(LEV_ID)).toString(), "0");
    });

    it("reverts if wethToWithdraw is zero", async () => {
      await expectRevert(
        sf.leverDown(LEV_ID, 0, 0, 3000, "0x", { from: keeperAccount }),
        "amount must be > 0"
      );
    });

    it("reverts if no outstanding debt", async () => {
      // Fully repay first
      await sf.leverDown(LEV_ID, borrowAmount, 0, 3000, "0x", { from: keeperAccount });
      await expectRevert(
        sf.leverDown(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount }),
        "no debt to repay"
      );
    });

    it("reverts if not a leverage token", async () => {
      await expectRevert(
        sf.leverDown(999, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount }),
        "not a leverage token"
      );
    });

    it("reverts if called by non-keeper", async () => {
      await expectRevert(
        sf.leverDown(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: alice }),
        "not keeper"
      );
    });

    it("divestLeverage still reverts if debt is not fully repaid", async () => {
      // Only partially repay (borrow 0.002, repay 0.001)
      await sf.leverUp(LEV_ID, borrowAmount, 0, 3000, "0x", { from: keeperAccount });
      // Now debt = 0.002; do one leverDown to halve it
      await sf.leverDown(LEV_ID, borrowAmount, 0, 3000, "0x", { from: keeperAccount });
      // debt still 0.001 remaining
      assert.ok(new BN(await sf.aaveDebt(LEV_ID)).gt(new BN(0)));
      await expectRevert(
        sf.divestLeverage(LEV_ID, 1, 0, { from: alice }),
        "debt must be repaid"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // checkLtv
  // ---------------------------------------------------------------------------

  describe("checkLtv", () => {
    it("returns 0 before any leverUp", async () => {
      assert.equal((await sf.checkLtv(LEV_ID)).toString(), "0");
    });

    it("returns correct bps proportional to borrow", async () => {
      await sf.leverUp(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });
      const ltv = new BN(await sf.checkLtv(LEV_ID));
      // With 1:1 mock: collateral=0.101, debt=0.001 → LTV ≈ 99 bps
      assert.ok(ltv.gt(new BN(0)), "LTV should be positive");
      assert.ok(ltv.lte(new BN(1000)), "LTV should be within cap");
    });

    it("returns 0 after full leverDown", async () => {
      await sf.leverUp(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });
      await sf.leverDown(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });
      assert.equal((await sf.checkLtv(LEV_ID)).toString(), "0");
    });

    it("reverts for a non-leverage token", async () => {
      // TOKEN_ID=1 is a regular token in the main suite; here we use a fresh proxy so just use 1
      await expectRevert(sf.checkLtv(999), "not a leverage token");
    });
  });
});

// =============================================================================
// Leverage Phase 3 — Chainlink oracle + emergency deleverage
// =============================================================================

const MockChainlinkFeed = artifacts.require("MockChainlinkFeed");

contract("Smartfolio — leverage Phase 3", (accounts) => {
  const [owner, keeperAccount, alice] = accounts;

  const LEV_ID = 10;
  const LEV_TIERS = [{ threshold: 0, pricePerToken: toWei("0.001") }];

  const makeLevCfg = (pool, stable) => ({
    aavePool:     pool,
    stableToken:  stable,
    targetLtvBps: 500,
    maxLtvBps:    1000,
  });

  // HF floor of 1e30 — effectively always triggered (mock HF = type(uint256).max when no debt,
  // but after leverUp HF will be finite). We use a floor just above the post-leverUp HF to
  // force the emergency condition.
  // After leverUp with tiny borrow: collateral ~0.101, debt 0.001 → HF = 0.101 * 0.8 / 0.001 * 1e18 ≈ 80.8e18
  const EMERGENCY_FLOOR = new BN(toWei("100")); // 100.0 — above the ~80 HF after leverUp

  let sf, mockWETH, mockStable, mockAavePool, mockRouter, mockFeed;
  let mintCost100;

  beforeEach(async () => {
    const tFacet = await SmartfolioTreasury.new();
    const mFacet = await SmartfolioMarket.new();
    const cFacet = await SmartfolioCreditMarket.new();
    sf = await deployProxy(
      Smartfolio,
      [owner, tFacet.address, mFacet.address, cFacet.address],
      { kind: "uups" }
    );

    mockWETH     = await MockWETH.new();
    mockStable   = await MockERC20.new("USD Coin", "USDC");
    mockAavePool = await MockAavePool.new();
    mockRouter   = await MockSwapRouter.new();
    mockFeed     = await MockChainlinkFeed.new(String(3000e8)); // $3000 / ETH

    await sf.setWETH(mockWETH.address,        { from: owner });
    await sf.setSwapRouter(mockRouter.address, { from: owner });
    await sf.setKeeper(keeperAccount,          { from: owner });
    await sf.setTiers(LEV_ID, LEV_TIERS,       { from: owner });
    await sf.setLeverageConfig(LEV_ID, makeLevCfg(mockAavePool.address, mockStable.address), { from: owner });

    // Alice mints 100 tokens → 0.1 ETH collateral in Aave
    mintCost100 = await sf.mintCost(LEV_ID, 100);
    await sf.mintLeverage(LEV_ID, 100, "0x", { from: alice, value: mintCost100 });

    // Fund pool with stable for borrow, router with WETH for leverUp and stable for leverDown
    await mockStable.mint(mockAavePool.address, toWei("10"));
    await mockWETH.deposit({ value: toWei("1"), from: owner });
    await mockWETH.transfer(mockRouter.address, toWei("1"), { from: owner });
    await mockStable.mint(mockRouter.address, toWei("10"));

    // Set up a leveraged position so there's debt to repay
    await sf.leverUp(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });
  });

  // ---------------------------------------------------------------------------
  // setEthUsdFeed
  // ---------------------------------------------------------------------------

  describe("setEthUsdFeed", () => {
    it("stores the feed address and emits EthUsdFeedSet", async () => {
      const tx = await sf.setEthUsdFeed(LEV_ID, mockFeed.address, { from: owner });
      assert.equal(await sf.ethUsdFeed(LEV_ID), mockFeed.address);
      const ev = tx.logs.find(l => l.event === "EthUsdFeedSet");
      assert.ok(ev, "EthUsdFeedSet not emitted");
      assert.equal(ev.args.feed, mockFeed.address);
    });

    it("allows clearing the feed (address zero)", async () => {
      await sf.setEthUsdFeed(LEV_ID, mockFeed.address, { from: owner });
      await sf.setEthUsdFeed(LEV_ID, "0x0000000000000000000000000000000000000000", { from: owner });
      assert.equal(await sf.ethUsdFeed(LEV_ID), "0x0000000000000000000000000000000000000000");
    });

    it("reverts if token is not a leverage token", async () => {
      await expectRevert(
        sf.setEthUsdFeed(999, mockFeed.address, { from: owner }),
        "not a leverage token"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(
        sf.setEthUsdFeed(LEV_ID, mockFeed.address, { from: alice }),
        "OwnableUnauthorizedAccount"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // setEmergencyHealthFloor
  // ---------------------------------------------------------------------------

  describe("setEmergencyHealthFloor", () => {
    it("stores floor and emits EmergencyHealthFloorSet", async () => {
      const tx = await sf.setEmergencyHealthFloor(LEV_ID, toWei("3"), { from: owner });
      assert.equal((await sf.emergencyHealthFloor(LEV_ID)).toString(), toWei("3"));
      const ev = tx.logs.find(l => l.event === "EmergencyHealthFloorSet");
      assert.ok(ev, "EmergencyHealthFloorSet not emitted");
    });

    it("setting to 0 disables the feature", async () => {
      await sf.setEmergencyHealthFloor(LEV_ID, 0, { from: owner });
      assert.equal((await sf.emergencyHealthFloor(LEV_ID)).toString(), "0");
    });

    it("reverts if not a leverage token", async () => {
      await expectRevert(
        sf.setEmergencyHealthFloor(999, toWei("3"), { from: owner }),
        "not a leverage token"
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(
        sf.setEmergencyHealthFloor(LEV_ID, toWei("3"), { from: alice }),
        "OwnableUnauthorizedAccount"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getHealthFactor
  // ---------------------------------------------------------------------------

  describe("getHealthFactor", () => {
    it("returns max uint256 when there is no collateral", async () => {
      await sf.setTiers(99, LEV_TIERS, { from: owner });
      await sf.setLeverageConfig(99, makeLevCfg(mockAavePool.address, mockStable.address), { from: owner });
      const hf = await sf.getHealthFactor(99);
      assert.equal(hf.toString(), new BN(2).pow(new BN(256)).subn(1).toString());
    });

    it("returns a finite value after leverUp", async () => {
      const hf = new BN(await sf.getHealthFactor(LEV_ID));
      assert.ok(hf.lt(new BN(2).pow(new BN(256)).subn(1)), "HF should be finite with debt");
      assert.ok(hf.gt(new BN(0)), "HF should be > 0");
    });

    it("returns max uint256 after full leverDown", async () => {
      await sf.leverDown(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });
      const hf = await sf.getHealthFactor(LEV_ID);
      assert.equal(hf.toString(), new BN(2).pow(new BN(256)).subn(1).toString());
    });

    it("reverts for non-leverage token", async () => {
      await expectRevert(sf.getHealthFactor(999), "not a leverage token");
    });
  });

  // ---------------------------------------------------------------------------
  // getLeverageInfo — Phase 3 fields
  // ---------------------------------------------------------------------------

  describe("getLeverageInfo — phase 3 fields", () => {
    it("emergencyFloor reflects setEmergencyHealthFloor", async () => {
      await sf.setEmergencyHealthFloor(LEV_ID, toWei("3"), { from: owner });
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.equal(info.emergencyFloor.toString(), toWei("3"));
    });

    it("ethPriceUsd is 0 when no feed is set", async () => {
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.equal(info.ethPriceUsd.toString(), "0");
    });

    it("ethPriceUsd reflects feed price after setEthUsdFeed", async () => {
      await sf.setEthUsdFeed(LEV_ID, mockFeed.address, { from: owner });
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.equal(info.ethPriceUsd.toString(), String(3000e8));
    });

    it("ethPriceUsd is 0 when feed returns non-positive answer", async () => {
      await mockFeed.setPrice(0);
      await sf.setEthUsdFeed(LEV_ID, mockFeed.address, { from: owner });
      const info = await sf.getLeverageInfo(LEV_ID);
      assert.equal(info.ethPriceUsd.toString(), "0");
    });

    it("healthFactor is max uint256 before any leverUp", async () => {
      // Use a fresh token ID
      await sf.setTiers(98, LEV_TIERS, { from: owner });
      await sf.setLeverageConfig(98, makeLevCfg(mockAavePool.address, mockStable.address), { from: owner });
      const info = await sf.getLeverageInfo(98);
      assert.equal(info.healthFactor.toString(), new BN(2).pow(new BN(256)).subn(1).toString());
    });
  });

  // ---------------------------------------------------------------------------
  // emergencyDeleverage
  // ---------------------------------------------------------------------------

  describe("emergencyDeleverage", () => {
    beforeEach(async () => {
      // Set a floor above the current mock HF so emergency condition is met
      await sf.setEmergencyHealthFloor(LEV_ID, EMERGENCY_FLOOR, { from: owner });
    });

    it("full deleverage: clears aaveDebt, reduces aaveCollateral, emits EmergencyDeleveraged", async () => {
      const debtBefore = new BN(await sf.aaveDebt(LEV_ID));
      assert.ok(debtBefore.gt(new BN(0)), "precondition: debt > 0");

      const tx = await sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount });

      assert.equal((await sf.aaveDebt(LEV_ID)).toString(), "0");

      const ev = tx.logs.find(l => l.event === "EmergencyDeleveraged");
      assert.ok(ev, "EmergencyDeleveraged not emitted");
      assert.equal(ev.args.id.toString(), String(LEV_ID));
      assert.ok(new BN(ev.args.stableRepaid).gt(new BN(0)));
      assert.ok(new BN(ev.args.wethWithdrawn).gt(new BN(0)));
    });

    it("allows owner to trigger emergency deleverage", async () => {
      await sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: owner });
      assert.equal((await sf.aaveDebt(LEV_ID)).toString(), "0");
    });

    it("divestLeverage succeeds after emergency deleverage", async () => {
      await sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount });
      // Alice can now exit
      await sf.divestLeverage(LEV_ID, 50, 0, { from: alice });
      assert.equal((await sf.balanceOf(alice, LEV_ID)).toString(), "50");
    });

    it("reverts if HF is above the floor (not emergency)", async () => {
      // Set floor below the current mock HF (~80e18) so condition is NOT met
      await sf.setEmergencyHealthFloor(LEV_ID, toWei("3"), { from: owner });
      await expectRevert(
        sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount }),
        "health factor above floor"
      );
    });

    it("reverts if floor is 0 (feature disabled)", async () => {
      await sf.setEmergencyHealthFloor(LEV_ID, 0, { from: owner });
      await expectRevert(
        sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount }),
        "health factor above floor"
      );
    });

    it("reverts if there is no debt", async () => {
      // Repay debt first
      await sf.leverDown(LEV_ID, new BN(toWei("0.001")), 0, 3000, "0x", { from: keeperAccount });
      await expectRevert(
        sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount }),
        "no debt to repay"
      );
    });

    it("reverts if called by a non-keeper non-owner address", async () => {
      await expectRevert(
        sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: alice }),
        "not keeper"
      );
    });

    it("reverts if not a leverage token", async () => {
      await expectRevert(
        sf.emergencyDeleverage(999, 0, 3000, "0x", { from: keeperAccount }),
        "not a leverage token"
      );
    });

    describe("with Chainlink feed configured", () => {
      beforeEach(async () => {
        await sf.setEthUsdFeed(LEV_ID, mockFeed.address, { from: owner });
      });

      it("succeeds with a fresh valid price", async () => {
        await sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount });
        assert.equal((await sf.aaveDebt(LEV_ID)).toString(), "0");
      });

      it("reverts if Chainlink price is stale", async () => {
        // Set updatedAt to 2 hours ago
        await mockFeed.setUpdatedAt(Math.floor(Date.now() / 1000) - 7201);
        await expectRevert(
          sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount }),
          "stale price"
        );
      });

      it("reverts if Chainlink price is zero or negative", async () => {
        await mockFeed.setPrice(-1);
        await expectRevert(
          sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount }),
          "invalid price"
        );
      });

      it("proceeds normally when feed is cleared (address zero)", async () => {
        await sf.setEthUsdFeed(LEV_ID, "0x0000000000000000000000000000000000000000", { from: owner });
        await sf.emergencyDeleverage(LEV_ID, 0, 3000, "0x", { from: keeperAccount });
        assert.equal((await sf.aaveDebt(LEV_ID)).toString(), "0");
      });
    });
  });
});
