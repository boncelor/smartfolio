/**
 * Sets the ERC1155 metadata URI on the Smartfolio proxy.
 *
 * Usage:
 *   METADATA_URL=https://your-app.vercel.app npx truffle exec scripts/set_uri.js --network sepolia
 *
 * The URI must contain {id} which the ERC1155 standard substitutes with the hex token ID.
 * Vercel routes /api/metadata/[id] so we use that path.
 */

const PROXY = "0xA24A683d4fE9C8A0a5DC96d175c419ABf70e8206";

module.exports = async function (callback) {
  try {
    const baseUrl = process.env.METADATA_URL;
    if (!baseUrl) return callback(new Error("Set METADATA_URL env var"));

    const uri = `${baseUrl}/api/metadata/{id}`;

    const Smartfolio = artifacts.require("Smartfolio");
    const sf = await Smartfolio.at(PROXY);
    const [owner] = await web3.eth.getAccounts();

    await sf.setURI(uri, { from: owner });
    console.log("✓ URI set to:", uri);
    callback();
  } catch (e) {
    callback(e);
  }
};
