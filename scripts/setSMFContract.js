/**
 * Sets the SMF contract address on the Smartfolio proxy.
 * Usage: npx truffle exec scripts/setSMFContract.js --network sepolia
 *
 * Reads VITE_CONTRACT_ADDRESS and VITE_SMF_ADDRESS from frontend/.env
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../frontend/.env') })
const Smartfolio = artifacts.require("Smartfolio");

module.exports = async function (callback) {
  try {
    const proxyAddr = process.env.VITE_CONTRACT_ADDRESS;
    const smfAddr   = process.env.VITE_SMF_ADDRESS;

    if (!proxyAddr || proxyAddr === '0x0000000000000000000000000000000000000000')
      throw new Error("VITE_CONTRACT_ADDRESS not set in frontend/.env");
    if (!smfAddr || smfAddr === '0x0000000000000000000000000000000000000000')
      throw new Error("VITE_SMF_ADDRESS not set in frontend/.env");

    console.log("Smartfolio proxy:", proxyAddr);
    console.log("New SMF address: ", smfAddr);

    const sf = await Smartfolio.at(proxyAddr);
    const tx = await sf.setSMFContract(smfAddr);

    console.log("\n✓ setSMFContract tx:", tx.tx);
    console.log("  Gas used:", tx.receipt.gasUsed);
    callback();
  } catch (err) {
    callback(err);
  }
};
