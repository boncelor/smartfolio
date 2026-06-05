const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio = artifacts.require("Smartfolio");

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
      // For string-based require messages we can match exactly.
      // Custom errors may not be decodable by ganache — skip the string check if so.
      const isCustomErrorRevert = err.message.includes("Custom error");
      if (!isCustomErrorRevert) {
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
    sf = await deployProxy(Smartfolio, [owner], { kind: "uups" });
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
      await expectRevert(sf.initialize(owner, { from: owner }), "InvalidInitialization");
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

    it("reverts when maxSupply is exceeded", async () => {
      await sf.setMaxSupply(TOKEN_ID, 5, { from: owner });
      const cost = await sf.mintCost(TOKEN_ID, 6);
      await expectRevert(
        sf.mint(alice, TOKEN_ID, 6, "0x", { from: alice, value: cost }),
        "exceeds max supply"
      );
    });

    it("allows mint up to maxSupply exactly", async () => {
      await sf.setMaxSupply(TOKEN_ID, 5, { from: owner });
      const cost = await sf.mintCost(TOKEN_ID, 5);
      await sf.mint(alice, TOKEN_ID, 5, "0x", { from: alice, value: cost });
      assert.equal((await sf.totalSupply(TOKEN_ID)).toString(), "5");
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

    it("reverts if any token in batch exceeds maxSupply", async () => {
      await sf.setMaxSupply(ID_B, 2, { from: owner });
      const costA = await sf.mintCost(ID_A, 5);
      const costB = await sf.mintCost(ID_B, 3);
      await expectRevert(
        sf.mintBatch(alice, [ID_A, ID_B], [5, 3], "0x", {
          from: alice,
          value: new BN(costA).add(new BN(costB)),
        }),
        "exceeds max supply"
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
  // setMaxSupply
  // ---------------------------------------------------------------------------

  describe("setMaxSupply", () => {
    it("sets and emits MaxSupplySet", async () => {
      const tx = await sf.setMaxSupply(TOKEN_ID, 500, { from: owner });
      assert.equal((await sf.maxSupply(TOKEN_ID)).toString(), "500");
      const log = tx.logs.find((l) => l.event === "MaxSupplySet");
      assert.ok(log);
      assert.equal(log.args.cap.toString(), "500");
    });

    it("cap of 0 removes the limit", async () => {
      await sf.setMaxSupply(TOKEN_ID, 5, { from: owner });
      await sf.setMaxSupply(TOKEN_ID, 0, { from: owner });
      const cost = await sf.mintCost(TOKEN_ID, 100);
      await sf.mint(alice, TOKEN_ID, 100, "0x", { from: alice, value: cost });
      assert.equal((await sf.totalSupply(TOKEN_ID)).toString(), "100");
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

    it("reports maxSupply if set", async () => {
      await sf.setMaxSupply(TOKEN_ID, 500, { from: owner });
      const info = await sf.tokenInfo(TOKEN_ID);
      assert.equal(info.maxSupply.toString(), "500");
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
});
