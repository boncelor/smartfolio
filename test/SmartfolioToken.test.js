const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const Smartfolio             = artifacts.require("Smartfolio");
const SmartfolioTreasury     = artifacts.require("SmartfolioTreasury");
const SmartfolioMarket       = artifacts.require("SmartfolioMarket");
const SmartfolioCreditMarket = artifacts.require("SmartfolioCreditMarket");
const SmartfolioToken        = artifacts.require("SmartfolioToken");
const SmartfolioTokenFactory = artifacts.require("SmartfolioTokenFactory");
const MockAavePool           = artifacts.require("MockAavePool");
const MockWETH               = artifacts.require("MockWETH");
const MockERC20              = artifacts.require("MockERC20");

const toWei = (n) => web3.utils.toWei(String(n), "ether");

const TIERS = [
  { threshold: 100,  pricePerToken: toWei("0.001") },
  { threshold: 1000, pricePerToken: toWei("0.01")  },
  { threshold: 10000,pricePerToken: toWei("0.1")   },
  { threshold: 0,    pricePerToken: toWei("1.0")   },
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

contract("SmartfolioToken + SmartfolioTokenFactory", (accounts) => {
  const [owner, alice, bob] = accounts;

  let sf, wrapper, factory;

  beforeEach(async () => {
    const treasury     = await SmartfolioTreasury.new();
    const market       = await SmartfolioMarket.new();
    const creditMarket = await SmartfolioCreditMarket.new();

    sf = await deployProxy(
      Smartfolio,
      [owner, treasury.address, market.address, creditMarket.address],
      { kind: "uups" }
    );
    await sf.setTiers(TIERS, { from: owner });
    await sf.setSMFContract(owner, { from: owner });

    // Mint some ERC1155 tokens to alice so she can wrap them.
    await sf.mintFunded(alice, TOKEN_ID, 10, { from: owner, value: toWei("0.01") });

    factory = await SmartfolioTokenFactory.new(sf.address, owner, { from: owner });
    await factory.deploy(TOKEN_ID, "Smartfolio Fund 1", "SF1", { from: owner });
    const wrapperAddress = await factory.wrappers(TOKEN_ID);
    wrapper = await SmartfolioToken.at(wrapperAddress);
  });

  // ---------------------------------------------------------------------------
  // SmartfolioTokenFactory
  // ---------------------------------------------------------------------------

  describe("SmartfolioTokenFactory", () => {
    it("records the wrapper address after deploy", async () => {
      const addr = await factory.wrappers(TOKEN_ID);
      assert.notEqual(addr, "0x0000000000000000000000000000000000000000");
    });

    it("emits WrapperDeployed with correct args", async () => {
      const factory2 = await SmartfolioTokenFactory.new(sf.address, owner, { from: owner });
      const tx = await factory2.deploy(TOKEN_ID, "Smartfolio Fund 1", "SF1", { from: owner });
      const log = tx.logs.find((l) => l.event === "WrapperDeployed");
      assert.ok(log);
      assert.equal(log.args.id.toString(), TOKEN_ID.toString());
      assert.equal(log.args.name, "Smartfolio Fund 1");
      assert.equal(log.args.symbol, "SF1");
    });

    it("reverts if the same id is deployed twice", async () => {
      await expectRevert(
        factory.deploy(TOKEN_ID, "Duplicate", "DUP", { from: owner })
      );
    });

    it("reverts if called by non-owner", async () => {
      await expectRevert(
        factory.deploy(2, "Token 2", "SF2", { from: alice })
      );
    });

    it("stores the correct smartfolio address", async () => {
      assert.equal(await factory.smartfolio(), sf.address);
    });

    it("reverts construction with zero smartfolio address", async () => {
      await expectRevert(
        SmartfolioTokenFactory.new(
          "0x0000000000000000000000000000000000000000",
          owner,
          { from: owner }
        )
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SmartfolioToken metadata
  // ---------------------------------------------------------------------------

  describe("SmartfolioToken metadata", () => {
    it("has the correct name and symbol", async () => {
      assert.equal(await wrapper.name(), "Smartfolio Fund 1");
      assert.equal(await wrapper.symbol(), "SF1");
    });

    it("stores the correct smartfolio and tokenId", async () => {
      assert.equal(await wrapper.smartfolio(), sf.address);
      assert.equal((await wrapper.tokenId()).toString(), TOKEN_ID.toString());
    });

    it("reports correct supportsInterface for IERC1155Receiver", async () => {
      // IERC1155Receiver interfaceId = 0x4e2312e0
      assert.ok(await wrapper.supportsInterface("0x4e2312e0"));
    });
  });

  // ---------------------------------------------------------------------------
  // wrap() via wrap()
  // ---------------------------------------------------------------------------

  describe("wrap()", () => {
    beforeEach(async () => {
      await sf.setApprovalForAll(wrapper.address, true, { from: alice });
    });

    it("transfers ERC1155 to wrapper and mints ERC20 1:1", async () => {
      await wrapper.wrap(5, { from: alice });

      assert.equal((await wrapper.balanceOf(alice)).toString(), "5");
      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "5");
      assert.equal((await sf.balanceOf(wrapper.address, TOKEN_ID)).toString(), "5");
    });

    it("emits Wrapped event", async () => {
      const tx = await wrapper.wrap(3, { from: alice });
      const log = tx.logs.find((l) => l.event === "Wrapped");
      assert.ok(log);
      assert.equal(log.args.account, alice);
      assert.equal(log.args.amount.toString(), "3");
    });

    it("reverts if caller has not approved the wrapper", async () => {
      await sf.setApprovalForAll(wrapper.address, false, { from: alice });
      await expectRevert(wrapper.wrap(5, { from: alice }));
    });

    it("reverts if caller has insufficient ERC1155 balance", async () => {
      await expectRevert(wrapper.wrap(100, { from: alice }));
    });
  });

  // ---------------------------------------------------------------------------
  // wrap via direct safeTransferFrom
  // ---------------------------------------------------------------------------

  describe("wrap via safeTransferFrom", () => {
    it("mints ERC20 to the sender when they transfer ERC1155 directly", async () => {
      await sf.safeTransferFrom(alice, wrapper.address, TOKEN_ID, 4, "0x", { from: alice });

      assert.equal((await wrapper.balanceOf(alice)).toString(), "4");
      assert.equal((await sf.balanceOf(wrapper.address, TOKEN_ID)).toString(), "4");
    });

    it("reverts if the ERC1155 is from the wrong contract", async () => {
      // Deploy a second Smartfolio and mint a token there — sending it to wrapper should revert.
      const t2 = await SmartfolioTreasury.new();
      const m2 = await SmartfolioMarket.new();
      const c2 = await SmartfolioCreditMarket.new();
      const sf2 = await deployProxy(
        Smartfolio,
        [owner, t2.address, m2.address, c2.address],
        { kind: "uups" }
      );
      await sf2.setTiers(TIERS, { from: owner });
      await sf2.setSMFContract(owner, { from: owner });
      await sf2.mintFunded(alice, TOKEN_ID, 5, { from: owner, value: toWei("0.005") });

      await expectRevert(
        sf2.safeTransferFrom(alice, wrapper.address, TOKEN_ID, 5, "0x", { from: alice })
      );
    });

    it("reverts if the token ID does not match", async () => {
      const OTHER_ID = 2;
      await sf.setTiers(TIERS, { from: owner });
      await sf.mintFunded(alice, OTHER_ID, 5, { from: owner, value: toWei("0.005") });

      await expectRevert(
        sf.safeTransferFrom(alice, wrapper.address, OTHER_ID, 5, "0x", { from: alice })
      );
    });

    it("reverts on batch transfer", async () => {
      await expectRevert(
        sf.safeBatchTransferFrom(alice, wrapper.address, [TOKEN_ID], [5], "0x", { from: alice })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // unwrap()
  // ---------------------------------------------------------------------------

  describe("unwrap()", () => {
    beforeEach(async () => {
      await sf.setApprovalForAll(wrapper.address, true, { from: alice });
      await wrapper.wrap(10, { from: alice });
    });

    it("burns ERC20 and returns ERC1155 1:1", async () => {
      await wrapper.unwrap(6, { from: alice });

      assert.equal((await wrapper.balanceOf(alice)).toString(), "4");
      assert.equal((await sf.balanceOf(alice, TOKEN_ID)).toString(), "6");
      assert.equal((await sf.balanceOf(wrapper.address, TOKEN_ID)).toString(), "4");
    });

    it("emits Unwrapped event", async () => {
      const tx = await wrapper.unwrap(3, { from: alice });
      const log = tx.logs.find((l) => l.event === "Unwrapped");
      assert.ok(log);
      assert.equal(log.args.account, alice);
      assert.equal(log.args.amount.toString(), "3");
    });

    it("reverts if caller has insufficient ERC20 balance", async () => {
      await expectRevert(wrapper.unwrap(11, { from: alice }));
    });

    it("reverts if bob tries to unwrap tokens he does not have", async () => {
      await expectRevert(wrapper.unwrap(1, { from: bob }));
    });
  });

  // ---------------------------------------------------------------------------
  // Safety guards — leverage and portfolio tokens
  // ---------------------------------------------------------------------------

  describe("safety: leverage token cannot be wrapped", () => {
    const LEVER_ID = 5;

    beforeEach(async () => {
      const aave   = await MockAavePool.new();
      const mweth  = await MockWETH.new();
      const stable = await MockERC20.new("USDC", "USDC");

      await sf.setWETH(mweth.address, { from: owner });
      await sf.setTiers(TIERS, { from: owner });
      await sf.setLeverageConfig(LEVER_ID, {
        aavePool:     aave.address,
        stableToken:  stable.address,
        targetLtvBps: 500,
        maxLtvBps:    1000,
      }, { from: owner });

      // Mint leverage tokens to alice.
      const cost = await sf.mintCost(3);
      await sf.mintLeverage(LEVER_ID, 3, "0x", { from: alice, value: cost });

      // Deploy a wrapper for the leverage token ID.
      await factory.deploy(LEVER_ID, "Smartfolio Lever 5", "SFL5", { from: owner });
    });

    it("reverts wrap() for a leverage token", async () => {
      const wrapperAddr  = await factory.wrappers(LEVER_ID);
      const leverWrapper = await SmartfolioToken.at(wrapperAddr);
      await sf.setApprovalForAll(wrapperAddr, true, { from: alice });
      await expectRevert(leverWrapper.wrap(1, { from: alice }));
    });

    it("reverts direct safeTransferFrom for a leverage token", async () => {
      const wrapperAddr = await factory.wrappers(LEVER_ID);
      await expectRevert(
        sf.safeTransferFrom(alice, wrapperAddr, LEVER_ID, 1, "0x", { from: alice })
      );
    });
  });

  describe("safety: portfolio-active token cannot be wrapped", () => {
    const PORT_ID = 6;
    const MockSwapRouter = artifacts.require("MockSwapRouter");

    beforeEach(async () => {
      const mweth  = await MockWETH.new();
      const router = await MockSwapRouter.new();
      const tokenA = await MockERC20.new("TokenA", "TKA");

      // Fund router so it can fulfil the WETH→tokenA swap during deploy.
      await tokenA.mint(router.address, toWei("10000"));
      await mweth.deposit({ value: toWei("0.1"), from: owner });
      await mweth.transfer(router.address, toWei("0.1"), { from: owner });

      await sf.setWETH(mweth.address,    { from: owner });
      await sf.setSwapRouter(router.address, { from: owner });
      await sf.setKeeper(owner,          { from: owner });
      await sf.setTiers(TIERS,  { from: owner });
      await sf.setPortfolioConfig(
        PORT_ID,
        [{ assetType: 0, token: tokenA.address, weightBps: 10000, poolFee: 3000, swapFee: 0, tickLower: 0, tickUpper: 0, swapPath: "0x", sellSwapPath: "0x" }],
        { from: owner }
      );

      // Mint tokens so there is a reserve, then deploy → portfolioActive[PORT_ID] = true.
      const cost = await sf.mintCost(5);
      await sf.mintFunded(alice, PORT_ID, 5, { from: owner, value: cost });
      await sf.deploy(PORT_ID, [0], 0, 0, 0, { from: owner });

      // Deploy a wrapper for the portfolio token ID.
      await factory.deploy(PORT_ID, "Smartfolio Port 6", "SFP6", { from: owner });
    });

    it("reverts wrap() when portfolio is active", async () => {
      const wrapperAddr = await factory.wrappers(PORT_ID);
      const portWrapper = await SmartfolioToken.at(wrapperAddr);
      await sf.setApprovalForAll(wrapperAddr, true, { from: alice });
      await expectRevert(portWrapper.wrap(1, { from: alice }));
    });

    it("reverts direct safeTransferFrom when portfolio is active", async () => {
      const wrapperAddr = await factory.wrappers(PORT_ID);
      await expectRevert(
        sf.safeTransferFrom(alice, wrapperAddr, PORT_ID, 1, "0x", { from: alice })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // ERC20 transferability
  // ---------------------------------------------------------------------------

  describe("ERC20 transferability", () => {
    beforeEach(async () => {
      await sf.setApprovalForAll(wrapper.address, true, { from: alice });
      await wrapper.wrap(10, { from: alice });
    });

    it("alice can transfer wrapped tokens to bob", async () => {
      await wrapper.transfer(bob, 4, { from: alice });
      assert.equal((await wrapper.balanceOf(bob)).toString(), "4");
      assert.equal((await wrapper.balanceOf(alice)).toString(), "6");
    });

    it("bob can unwrap tokens received via ERC20 transfer", async () => {
      await wrapper.transfer(bob, 4, { from: alice });
      await wrapper.unwrap(4, { from: bob });
      assert.equal((await sf.balanceOf(bob, TOKEN_ID)).toString(), "4");
      assert.equal((await wrapper.balanceOf(bob)).toString(), "0");
    });
  });
});
