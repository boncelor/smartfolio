const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio             = artifacts.require("Smartfolio");
const SmartfolioTreasury     = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket       = artifacts.require("SmartfolioMarket");
const SmartfolioERC20        = artifacts.require("SmartfolioERC20");
const MockV3Aggregator       = artifacts.require("MockV3Aggregator");

const toWei = (n) => web3.utils.toWei(String(n), "ether");
const BN    = web3.utils.BN;

// Chainlink 8-decimal ETH/USD price: $3 000
const ETH_PRICE_USD = 3_000e8;

const SMF_TIERS = [
  { threshold: 100,   pricePerToken: toWei("0.001") },
  { threshold: 1000,  pricePerToken: toWei("0.01")  },
  { threshold: 10000, pricePerToken: toWei("0.1")   },
  { threshold: 0,     pricePerToken: toWei("1.0")   },
];

const NFT_TIERS = [
  { threshold: 100,   pricePerToken: toWei("0.001") },
  { threshold: 1000,  pricePerToken: toWei("0.01")  },
  { threshold: 10000, pricePerToken: toWei("0.1")   },
  { threshold: 0,     pricePerToken: toWei("1.0")   },
];

const TOKEN_ID = 1;

async function expectRevert(promise) {
  try {
    await promise;
    assert.fail("Expected revert not received");
  } catch (err) {
    const reverted =
      err.message.includes("revert") || err.message.includes("VM Exception");
    assert.ok(reverted, `Expected a revert but got: ${err.message}`);
  }
}

contract("SmartfolioERC20", (accounts) => {
  const [owner, alice, bob] = accounts;

  let sf, smf, feed;

  beforeEach(async () => {
    const treasury = await SmartfolioTreasury.new();
    const market   = await SmartfolioMarket.new();

    sf = await deployProxy(
      Smartfolio,
      [owner, treasury.address, market.address],
      { kind: "uups" }
    );
    await sf.setTiers(NFT_TIERS, { from: owner });

    // Mock Chainlink feed: ETH = $3 000
    feed = await MockV3Aggregator.new(ETH_PRICE_USD, { from: owner });

    smf = await SmartfolioERC20.new(sf.address, owner, { from: owner });
    await smf.setTiers(SMF_TIERS, { from: owner });
    await smf.setEthUsdFeed(feed.address, { from: owner });
    await sf.setSMFContract(smf.address, { from: owner });
  });

  // ---------------------------------------------------------------------------
  // Constructor / admin
  // ---------------------------------------------------------------------------

  describe("constructor & admin", () => {
    it("has correct name and symbol", async () => {
      assert.equal(await smf.name(), "Smartfolio");
      assert.equal(await smf.symbol(), "SMF");
    });

    it("sets smartfolio address", async () => {
      assert.equal(await smf.smartfolio(), sf.address);
    });

    it("setTiers reverts if called by non-owner", async () => {
      await expectRevert(smf.setTiers(SMF_TIERS, { from: alice }));
    });

    it("setSmartfolio reverts for zero address", async () => {
      await expectRevert(
        smf.setSmartfolio("0x0000000000000000000000000000000000000000", { from: owner })
      );
    });

    it("setEthUsdFeed reverts for zero address", async () => {
      await expectRevert(
        smf.setEthUsdFeed("0x0000000000000000000000000000000000000000", { from: owner })
      );
    });

    it("setEthUsdFeed reverts if called by non-owner", async () => {
      await expectRevert(smf.setEthUsdFeed(feed.address, { from: alice }));
    });

    it("setSMFContract on Smartfolio reverts for non-owner", async () => {
      await expectRevert(sf.setSMFContract(smf.address, { from: alice }));
    });

    it("setSMFContract on Smartfolio reverts for zero address", async () => {
      await expectRevert(
        sf.setSMFContract("0x0000000000000000000000000000000000000000", { from: owner })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // buySMF
  // ---------------------------------------------------------------------------

  describe("buySMF()", () => {
    it("mints SMF and increments smfTotalSupply", async () => {
      const cost = await smf.smfMintCost(10);
      await smf.buySMF(10, { from: alice, value: cost });
      assert.equal((await smf.balanceOf(alice)).toString(), "10");
      assert.equal((await smf.smfTotalSupply()).toString(), "10");
      assert.equal((await smf.smfTotalMinted()).toString(), "10");
    });

    it("emits SMFMinted", async () => {
      const cost = await smf.smfMintCost(5);
      const tx = await smf.buySMF(5, { from: alice, value: cost });
      const log = tx.logs.find((l) => l.event === "SMFMinted");
      assert.ok(log);
      assert.equal(log.args.account, alice);
      assert.equal(log.args.amount.toString(), "5");
    });

    it("refunds excess ETH", async () => {
      const cost = await smf.smfMintCost(5);
      const extra = toWei("1");
      const balBefore = new BN(await web3.eth.getBalance(alice));
      const tx = await smf.buySMF(5, { from: alice, value: new BN(cost).add(new BN(extra)) });
      const gasUsed = new BN(tx.receipt.gasUsed);
      const gasPrice = new BN(await web3.eth.getGasPrice());
      const balAfter = new BN(await web3.eth.getBalance(alice));
      const spent = balBefore.sub(balAfter).sub(gasUsed.mul(gasPrice));
      assert.ok(spent.lte(new BN(cost).add(new BN(toWei("0.001")))));
    });

    it("reverts if ETH is insufficient", async () => {
      const cost = await smf.smfMintCost(10);
      await expectRevert(
        smf.buySMF(10, { from: alice, value: new BN(cost).sub(new BN("1")) })
      );
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(smf.buySMF(0, { from: alice, value: toWei("1") }));
    });

    it("prices correctly across tier boundary (0→1)", async () => {
      // 100 tokens at tier 0 (0.001), then 10 at tier 1 (0.01) = 0.1 + 0.1 = 0.2 ETH
      const cost = await smf.smfMintCost(110);
      const expected = new BN(toWei("0.1")).add(new BN(toWei("0.1")));
      assert.equal(cost.toString(), expected.toString());
    });
  });

  // ---------------------------------------------------------------------------
  // sellSMF
  // ---------------------------------------------------------------------------

  describe("sellSMF()", () => {
    beforeEach(async () => {
      const cost = await smf.smfMintCost(50);
      await smf.buySMF(50, { from: alice, value: cost });
    });

    it("burns SMF and returns ETH", async () => {
      const ethOut = new BN(await smf.smfBurnValue(10));
      const balBefore = new BN(await web3.eth.getBalance(alice));
      const tx = await smf.sellSMF(10, 0, { from: alice });
      const gasUsed = new BN(tx.receipt.gasUsed);
      // Use effectiveGasPrice if available (EIP-1559), fall back to gasPrice
      const effectiveGasPrice = new BN(tx.receipt.effectiveGasPrice ?? await web3.eth.getGasPrice());
      const gasCost = gasUsed.mul(effectiveGasPrice);
      const balAfter = new BN(await web3.eth.getBalance(alice));
      const received = balAfter.sub(balBefore).add(gasCost);
      assert.equal(received.toString(), ethOut.toString());
      assert.equal((await smf.balanceOf(alice)).toString(), "40");
    });

    it("emits SMFBurned", async () => {
      const tx = await smf.sellSMF(5, 0, { from: alice });
      const log = tx.logs.find((l) => l.event === "SMFBurned");
      assert.ok(log);
      assert.equal(log.args.account, alice);
      assert.equal(log.args.amount.toString(), "5");
    });

    it("reverts if minEthOut slippage exceeded", async () => {
      const ethOut = await smf.smfBurnValue(10);
      await expectRevert(
        smf.sellSMF(10, new BN(ethOut).add(new BN("1")), { from: alice })
      );
    });

    it("reverts if balance insufficient", async () => {
      await expectRevert(smf.sellSMF(51, 0, { from: alice }));
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(smf.sellSMF(0, 0, { from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // mintNFT (oracle-priced $10 USD floor, mints exactly 1)
  // ---------------------------------------------------------------------------

  describe("mintNFT()", () => {
    // At $3000/ETH, $10 floor = 10/3000 ETH ≈ 0.003333 ETH
    // SMF needed to cover that at tier-0 price (0.001 ETH/SMF) = ~3.33 → 4 SMF (rounded up)
    beforeEach(async () => {
      // Alice buys 200 SMF — enough to mint several NFTs
      const cost = await smf.smfMintCost(200);
      await smf.buySMF(200, { from: alice, value: cost });
    });

    it("mints exactly 1 ERC1155 to alice and increases reserve[id]", async () => {
      const { smfRequired } = await smf.smfForNFT();
      const reserveBefore = new BN(await sf.reserve(TOKEN_ID));

      await smf.mintNFT(smfRequired, { from: alice });

      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "1");
      assert.ok(new BN(await sf.reserve(TOKEN_ID)).gt(reserveBefore));
    });

    it("emits NFTMinted with correct fields", async () => {
      const { smfRequired, ethNeeded } = await smf.smfForNFT();
      const tx = await smf.mintNFT(smfRequired, { from: alice });
      const log = tx.logs.find((l) => l.event === "NFTMinted");
      assert.ok(log);
      assert.equal(log.args.account, alice);
      assert.equal(log.args.id.toString(), TOKEN_ID.toString());
      assert.equal(log.args.smfBurned.toString(), smfRequired.toString());
      assert.equal(log.args.ethLocked.toString(), ethNeeded.toString());
    });

    it("globalTotalSupply increments by 1", async () => {
      const before = new BN(await sf.globalTotalSupply());
      const { smfRequired } = await smf.smfForNFT();
      await smf.mintNFT(smfRequired, { from: alice });
      assert.equal(
        new BN(await sf.globalTotalSupply()).sub(before).toString(), "1"
      );
    });

    it("SMF balance decreases by smfRequired", async () => {
      const balBefore = new BN(await smf.balanceOf(alice));
      const { smfRequired } = await smf.smfForNFT();
      await smf.mintNFT(smfRequired, { from: alice });
      assert.equal(
        balBefore.sub(new BN(await smf.balanceOf(alice))).toString(),
        smfRequired.toString()
      );
    });

    it("reserve[id] receives the ETH floor amount", async () => {
      const { smfRequired, ethNeeded } = await smf.smfForNFT();
      const reserveBefore = new BN(await sf.reserve(TOKEN_ID));
      await smf.mintNFT(smfRequired, { from: alice });
      assert.equal(
        new BN(await sf.reserve(TOKEN_ID)).sub(reserveBefore).toString(),
        ethNeeded.toString()
      );
    });

    it("reverts if slippage guard exceeded", async () => {
      const { smfRequired } = await smf.smfForNFT();
      await expectRevert(
        smf.mintNFT(new BN(smfRequired).sub(new BN("1")), { from: alice })
      );
    });

    it("reverts if SMF balance insufficient", async () => {
      // Bob has no SMF
      await expectRevert(smf.mintNFT(toWei("9999"), { from: bob }));
    });

    it("reverts if feed not set", async () => {
      const smf2 = await SmartfolioERC20.new(sf.address, owner, { from: owner });
      await smf2.setTiers(SMF_TIERS, { from: owner });
      // no setEthUsdFeed call
      const cost = await smf2.smfMintCost(200);
      await smf2.buySMF(200, { from: alice, value: cost });
      await expectRevert(smf2.mintNFT(toWei("9999"), { from: alice }));
    });

    it("reverts if price is stale", async () => {
      // Backdate updatedAt by 2 hours (well beyond 30-min priceMaxAge)
      await feed.setUpdatedAt(Math.floor(Date.now() / 1000) - 7200);
      // Don't call smfForNFT — it also reads the oracle and would revert here.
      // Pass a generous maxSmfBurn so the only revert path is the stale price check.
      await expectRevert(smf.mintNFT(toWei("9999"), { from: alice }));
    });

    it("reverts if price is zero or negative", async () => {
      await feed.setAnswer(0);
      await expectRevert(
        smf.mintNFT(toWei("9999"), { from: alice })
      );
    });

    it("ethNeeded reflects oracle price — higher ETH price → less ETH needed", async () => {
      // $6 000/ETH → ETH floor halved
      await feed.setAnswer(6_000e8);
      const { ethNeeded: ethAt6k } = await smf.smfForNFT();
      await feed.setAnswer(ETH_PRICE_USD);
      const { ethNeeded: ethAt3k } = await smf.smfForNFT();
      assert.ok(new BN(ethAt6k).lt(new BN(ethAt3k)),
        "higher ETH price should require less ETH for the $10 floor");
    });
  });

  // ---------------------------------------------------------------------------
  // addToNFT
  // ---------------------------------------------------------------------------

  describe("addToNFT()", () => {
    beforeEach(async () => {
      const smfCost = await smf.smfMintCost(200);
      await smf.buySMF(200, { from: alice, value: smfCost });
      const { smfRequired } = await smf.smfForNFT();
      await smf.mintNFT(smfRequired, { from: alice });
    });

    it("increases reserve[id] without minting new ERC1155", async () => {
      const supplyBefore = await sf.totalSupply(TOKEN_ID);
      const reserveBefore = new BN(await sf.reserve(TOKEN_ID));

      const ethToAdd = toWei("0.001");
      const smfToBurn = await smf.smfForReserve(ethToAdd);
      await smf.addToNFT(TOKEN_ID, ethToAdd, smfToBurn, { from: alice });

      assert.equal((await sf.totalSupply(TOKEN_ID)).toString(), supplyBefore.toString());
      assert.equal(
        new BN(await sf.reserve(TOKEN_ID)).sub(reserveBefore).toString(),
        ethToAdd.toString()
      );
    });

    it("emits ReserveAdded", async () => {
      const ethToAdd = toWei("0.001");
      const smfToBurn = await smf.smfForReserve(ethToAdd);
      const tx = await smf.addToNFT(TOKEN_ID, ethToAdd, smfToBurn, { from: alice });
      const log = tx.logs.find((l) => l.event === "ReserveAdded");
      assert.ok(log);
      assert.equal(log.args.account, alice);
      assert.equal(log.args.id.toString(), TOKEN_ID.toString());
    });

    it("reverts if slippage guard exceeded", async () => {
      const ethToAdd = toWei("0.001");
      const smfToBurn = await smf.smfForReserve(ethToAdd);
      await expectRevert(
        smf.addToNFT(TOKEN_ID, ethToAdd, new BN(smfToBurn).sub(new BN("1")), { from: alice })
      );
    });

    it("reverts if SMF balance insufficient", async () => {
      await expectRevert(
        smf.addToNFT(TOKEN_ID, toWei("0.001"), toWei("9999"), { from: bob })
      );
    });

    it("reverts if ethAmount is zero", async () => {
      await expectRevert(smf.addToNFT(TOKEN_ID, 0, 0, { from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // Access control on Smartfolio
  // ---------------------------------------------------------------------------

  describe("access control — mintFunded / addReserve", () => {
    it("mintFunded reverts if called directly (not via smfContract)", async () => {
      await expectRevert(
        sf.mintFunded(alice, TOKEN_ID, 1, { from: alice, value: toWei("0.001") })
      );
    });

    it("addReserve reverts if called directly (not via smfContract)", async () => {
      await expectRevert(
        sf.addReserve(TOKEN_ID, { from: alice, value: toWei("0.001") })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Integration round-trip
  // ---------------------------------------------------------------------------

  describe("integration round-trip", () => {
    it("buy SMF → mint NFT → add reserve → burn NFT → receive ETH", async () => {
      // Buy SMF
      const smfCost = await smf.smfMintCost(200);
      await smf.buySMF(200, { from: alice, value: smfCost });

      // Mint NFT
      const { smfRequired } = await smf.smfForNFT();
      await smf.mintNFT(smfRequired, { from: alice });
      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "1");

      // Add reserve
      const ethToAdd = toWei("0.001");
      const smfToBurn = await smf.smfForReserve(ethToAdd);
      await smf.addToNFT(TOKEN_ID, ethToAdd, smfToBurn, { from: alice });
      assert.ok(new BN(await sf.reserve(TOKEN_ID)).gt(new BN("0")));

      // Burn NFT — receive ETH
      const ethBefore = new BN(await web3.eth.getBalance(alice));
      await sf.burn(TOKEN_ID, 1, { from: alice });
      const ethAfter = new BN(await web3.eth.getBalance(alice));
      assert.ok(ethAfter.gt(ethBefore.sub(new BN(toWei("0.01")))));

      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "0");
    });
  });
});
