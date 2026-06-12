require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const SmartfolioERC20 = artifacts.require("SmartfolioERC20");

// Existing Smartfolio proxy — already deployed, do not redeploy.
const SMARTFOLIO_PROXY = process.env.VITE_CONTRACT_ADDRESS;

module.exports = async function (deployer, network, accounts) {
  if (!SMARTFOLIO_PROXY || SMARTFOLIO_PROXY === '0x0000000000000000000000000000000000000000') {
    throw new Error("VITE_CONTRACT_ADDRESS not set in .env");
  }

  const initialOwner = accounts[0];

  await deployer.deploy(SmartfolioERC20, SMARTFOLIO_PROXY, initialOwner);
  const smf = await SmartfolioERC20.deployed();

  console.log("\n=== SmartfolioERC20 deployed ===");
  console.log("  Address:          ", smf.address);
  console.log("  Smartfolio proxy: ", SMARTFOLIO_PROXY);
  console.log("\nNext steps:");
  console.log("  1. Call setSMFContract('" + smf.address + "') on the Smartfolio proxy");
  console.log("  2. Update VITE_SMF_ADDRESS=" + smf.address + " in Vercel env vars");
  console.log("  3. Redeploy frontend");
};
