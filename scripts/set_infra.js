/**
 * Configure infrastructure addresses on the Smartfolio proxy.
 *
 * Sets WETH, SwapRouter, and optionally PositionManager and Keeper.
 * Safe to re-run — each setter is idempotent.
 *
 * Run: npx truffle exec scripts/set_infra.js --network sepolia
 */

const Smartfolio = artifacts.require("Smartfolio");

const PROXY_ADDRESS = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

// ── Sepolia addresses ──────────────────────────────────────────────────────────
const WETH_SEPOLIA        = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const SWAP_ROUTER_SEPOLIA = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // ISwapRouter v1

// Set to the Uniswap V3 NonfungiblePositionManager address if you have LP slices.
// Leave as null to skip.
const POSITION_MANAGER_SEPOLIA = null; // "0x1238536071E1c677A632429e3655c799b22cDA52"

// Set to the keeper wallet address, or null to skip.
const KEEPER_ADDRESS = null;
// ──────────────────────────────────────────────────────────────────────────────

module.exports = async function (callback) {
  try {
    const proxy = await Smartfolio.at(PROXY_ADDRESS);
    const owner = await proxy.owner();
    console.log("Proxy owner:", owner);

    // ── Read current state ───────────────────────────────────────────────────
    const currentWeth        = await proxy.weth();
    const currentRouter      = await proxy.swapRouter();
    const currentPosManager  = await proxy.positionManager();
    const currentKeeper      = await proxy.keeper();

    console.log("\nCurrent state:");
    console.log("  weth:            ", currentWeth);
    console.log("  swapRouter:      ", currentRouter);
    console.log("  positionManager: ", currentPosManager);
    console.log("  keeper:          ", currentKeeper);

    // ── Set WETH ─────────────────────────────────────────────────────────────
    if (currentWeth.toLowerCase() !== WETH_SEPOLIA.toLowerCase()) {
      console.log("\nSetting WETH →", WETH_SEPOLIA);
      await proxy.setWETH(WETH_SEPOLIA);
      console.log("  ✓ WETH set");
    } else {
      console.log("\n✓ WETH already set correctly");
    }

    // ── Set SwapRouter ────────────────────────────────────────────────────────
    if (currentRouter.toLowerCase() !== SWAP_ROUTER_SEPOLIA.toLowerCase()) {
      console.log("Setting SwapRouter →", SWAP_ROUTER_SEPOLIA);
      await proxy.setSwapRouter(SWAP_ROUTER_SEPOLIA);
      console.log("  ✓ SwapRouter set");
    } else {
      console.log("✓ SwapRouter already set correctly");
    }

    // ── Set PositionManager (optional) ───────────────────────────────────────
    if (POSITION_MANAGER_SEPOLIA) {
      if (currentPosManager.toLowerCase() !== POSITION_MANAGER_SEPOLIA.toLowerCase()) {
        console.log("Setting PositionManager →", POSITION_MANAGER_SEPOLIA);
        await proxy.setPositionManager(POSITION_MANAGER_SEPOLIA);
        console.log("  ✓ PositionManager set");
      } else {
        console.log("✓ PositionManager already set correctly");
      }
    }

    // ── Set Keeper (optional) ────────────────────────────────────────────────
    if (KEEPER_ADDRESS) {
      if (currentKeeper.toLowerCase() !== KEEPER_ADDRESS.toLowerCase()) {
        console.log("Setting Keeper →", KEEPER_ADDRESS);
        await proxy.setKeeper(KEEPER_ADDRESS);
        console.log("  ✓ Keeper set");
      } else {
        console.log("✓ Keeper already set correctly");
      }
    }

    // ── Verify ───────────────────────────────────────────────────────────────
    console.log("\nFinal state:");
    console.log("  weth:            ", await proxy.weth());
    console.log("  swapRouter:      ", await proxy.swapRouter());
    console.log("  positionManager: ", await proxy.positionManager());
    console.log("  keeper:          ", await proxy.keeper());

    callback();
  } catch (err) {
    callback(err);
  }
};
