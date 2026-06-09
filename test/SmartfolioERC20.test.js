const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio             = artifacts.require("Smartfolio");
const SmartfolioTreasury     = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket       = artifacts.require("SmartfolioMarket");
const SmartfolioCreditMarket = artifacts.require("SmartfolioCreditMarket");
const SmartfolioLiquidityMarket = artifacts.require("SmartfolioLiquidityMarket");
const SmartfolioERC20        = artifacts.require("SmartfolioERC20");

const toWei = (n) => web3.utils.toWei(String(n), "ether");
const BN    = web3.utils.BN;

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

  let sf, smf;

  beforeEach(async () => {
    const treasury     = await SmartfolioTreasury.new();
    const market       = await SmartfolioMarket.new();
    const creditMarket = await SmartfolioCreditMarket.new();
    const liqMarket    = await SmartfolioLiquidityMarket.new();

    sf = await deployProxy(
      Smartfolio,
      [owner, treasury.address, market.address, creditMarket.address],
      { kind: "uups" }
    );
    await sf.setLiquidityMarketFacet(liqMarket.address, { from: owner });
    await sf.setTiers(NFT_TIERS, { from: owner });

    smf = await SmartfolioERC20.new(sf.address, owner, { from: owner });
    await smf.setTiers(SMF_TIERS, { from: owner });
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

    it("defaults conversionFeeBps to 100 (1%)", async () => {
      assert.equal((await smf.conversionFeeBps()).toString(), "100");
    });

    it("setConversionFeeBps updates the rate", async () => {
      await smf.setConversionFeeBps(200, { from: owner });
      assert.equal((await smf.conversionFeeBps()).toString(), "200");
    });

    it("setConversionFeeBps reverts above 500", async () => {
      await expectRevert(smf.setConversionFeeBps(501, { from: owner }));
    });

    it("setConversionFeeBps reverts if called by non-owner", async () => {
      await expectRevert(smf.setConversionFeeBps(50, { from: alice }));
    });

    it("setTiers reverts if called by non-owner", async () => {
      await expectRevert(smf.setTiers(SMF_TIERS, { from: alice }));
    });

    it("setSmartfolio reverts for zero address", async () => {
      await expectRevert(
        smf.setSmartfolio("0x0000000000000000000000000000000000000000", { from: owner })
      );
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
      // spent should be approximately `cost` (within gas rounding)
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
  // mintNFT
  // ---------------------------------------------------------------------------

  describe("mintNFT()", () => {
    beforeEach(async () => {
      // Alice buys 500 SMF — enough to mint some NFTs
      const cost = await smf.smfMintCost(500);
      await smf.buySMF(500, { from: alice, value: cost });
    });

    it("mints ERC1155 to alice, burns SMF, increases reserve[id]", async () => {
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 1);
      const reserveBefore = await sf.reserve(TOKEN_ID);

      await smf.mintNFT(TOKEN_ID, 1, smfRequired, { from: alice });

      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "1");
      const reserveAfter = await sf.reserve(TOKEN_ID);
      assert.ok(new BN(reserveAfter).gt(new BN(reserveBefore)));
    });

    it("emits NFTMinted", async () => {
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 1);
      const tx = await smf.mintNFT(TOKEN_ID, 1, smfRequired, { from: alice });
      const log = tx.logs.find((l) => l.event === "NFTMinted");
      assert.ok(log);
      assert.equal(log.args.account, alice);
      assert.equal(log.args.id.toString(), TOKEN_ID.toString());
      assert.equal(log.args.nftAmount.toString(), "1");
    });

    it("globalTotalSupply on Smartfolio increments", async () => {
      const supplyBefore = await sf.globalTotalSupply();
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 3);
      await smf.mintNFT(TOKEN_ID, 3, smfRequired, { from: alice });
      const supplyAfter = await sf.globalTotalSupply();
      assert.equal(
        new BN(supplyAfter).sub(new BN(supplyBefore)).toString(), "3"
      );
    });

    it("SMF balance decreases by smfRequired", async () => {
      const balBefore = await smf.balanceOf(alice);
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 1);
      await smf.mintNFT(TOKEN_ID, 1, smfRequired, { from: alice });
      const balAfter = await smf.balanceOf(alice);
      assert.equal(
        new BN(balBefore).sub(new BN(balAfter)).toString(),
        smfRequired.toString()
      );
    });

    it("treasury receives conversion fee", async () => {
      await smf.setTreasury(bob, { from: owner });
      const treasuryBefore = new BN(await web3.eth.getBalance(bob));
      const { smfRequired, feePaid } = await smf.smfForNFT(TOKEN_ID, 1);
      await smf.mintNFT(TOKEN_ID, 1, smfRequired, { from: alice });
      const treasuryAfter = new BN(await web3.eth.getBalance(bob));
      assert.equal(
        treasuryAfter.sub(treasuryBefore).toString(),
        feePaid.toString()
      );
    });

    it("reserve[id] receives ethNeeded (not ethNeeded + fee)", async () => {
      const ethNeeded = await sf.mintCost(1);
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 1);
      const reserveBefore = new BN(await sf.reserve(TOKEN_ID));
      await smf.mintNFT(TOKEN_ID, 1, smfRequired, { from: alice });
      const reserveAfter = new BN(await sf.reserve(TOKEN_ID));
      assert.equal(
        reserveAfter.sub(reserveBefore).toString(),
        ethNeeded.toString()
      );
    });

    it("works with zero conversion fee", async () => {
      await smf.setConversionFeeBps(0, { from: owner });
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 1);
      await smf.mintNFT(TOKEN_ID, 1, smfRequired, { from: alice });
      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "1");
    });

    it("reverts if maxSmfBurn slippage exceeded", async () => {
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 1);
      await expectRevert(
        smf.mintNFT(TOKEN_ID, 1, new BN(smfRequired).sub(new BN("1")), { from: alice })
      );
    });

    it("reverts if SMF balance insufficient", async () => {
      // Bob has no SMF
      await expectRevert(
        smf.mintNFT(TOKEN_ID, 1, toWei("9999"), { from: bob })
      );
    });

    it("reverts if amount is zero", async () => {
      await expectRevert(smf.mintNFT(TOKEN_ID, 0, 0, { from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // addToNFT
  // ---------------------------------------------------------------------------

  describe("addToNFT()", () => {
    beforeEach(async () => {
      // Alice buys SMF and mints an NFT first
      const smfCost = await smf.smfMintCost(500);
      await smf.buySMF(500, { from: alice, value: smfCost });
      const { smfRequired } = await smf.smfForNFT(TOKEN_ID, 1);
      await smf.mintNFT(TOKEN_ID, 1, smfRequired, { from: alice });
    });

    it("increases reserve[id] without minting new ERC1155", async () => {
      const supplyBefore = await sf.totalSupply(TOKEN_ID);
      const reserveBefore = new BN(await sf.reserve(TOKEN_ID));

      const ethToAdd = toWei("0.001");
      const smfToBurn = await smf.smfForReserve(ethToAdd);
      await smf.addToNFT(TOKEN_ID, ethToAdd, smfToBurn, { from: alice });

      assert.equal((await sf.totalSupply(TOKEN_ID)).toString(), supplyBefore.toString());
      const reserveAfter = new BN(await sf.reserve(TOKEN_ID));
      assert.equal(reserveAfter.sub(reserveBefore).toString(), ethToAdd.toString());
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

    it("reverts if maxSmfBurn slippage exceeded", async () => {
      const ethToAdd = toWei("0.001");
      const smfToBurn = await smf.smfForReserve(ethToAdd);
      await expectRevert(
        smf.addToNFT(TOKEN_ID, ethToAdd, new BN(smfToBurn).sub(new BN("1")), { from: alice })
      );
    });

    it("reverts if SMF balance insufficient", async () => {
      // Bob has no SMF
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
      const { smfRequired: smfForMint } = await smf.smfForNFT(TOKEN_ID, 1);
      await smf.mintNFT(TOKEN_ID, 1, smfForMint, { from: alice });
      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "1");

      // Add reserve
      const ethToAdd = toWei("0.001");
      const smfToBurn = await smf.smfForReserve(ethToAdd);
      await smf.addToNFT(TOKEN_ID, ethToAdd, smfToBurn, { from: alice });

      const reserveAfterAdd = new BN(await sf.reserve(TOKEN_ID));
      assert.ok(reserveAfterAdd.gt(new BN("0")));

      // Burn NFT — receive ETH
      const ethBefore = new BN(await web3.eth.getBalance(alice));
      await sf.burn(TOKEN_ID, 1, { from: alice });
      const ethAfter = new BN(await web3.eth.getBalance(alice));
      assert.ok(ethAfter.gt(ethBefore.sub(new BN(toWei("0.01")))));

      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "0");
    });
  });
});
