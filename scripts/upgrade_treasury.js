require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const Smartfolio         = artifacts.require("Smartfolio");
const SmartfolioTreasury = artifacts.require("SmartfolioTreasury");

const PROXY = process.env.VITE_CONTRACT_ADDRESS;

module.exports = async function (callback) {
  try {
    const [owner] = await web3.eth.getAccounts();
    console.log("Upgrading treasury from:", owner);
    console.log("Proxy:                  ", PROXY);

    const proxy = await Smartfolio.at(PROXY);

    // Deploy new SmartfolioTreasury (portfolioActive=true on mintWithSMF)
    const treasury = await SmartfolioTreasury.new({ from: owner });
    console.log("✓ New SmartfolioTreasury:", treasury.address);

    // setTreasuryFacet requires whenPaused
    await proxy.pause({ from: owner });
    console.log("✓ Proxy paused");

    await proxy.setTreasuryFacet(treasury.address, { from: owner });
    console.log("✓ Treasury facet updated");

    await proxy.unpause({ from: owner });
    console.log("✓ Proxy unpaused");

    console.log("\nDone — treasury upgraded. No SMF redeployment needed.");

    callback();
  } catch (e) {
    callback(e);
  }
};
