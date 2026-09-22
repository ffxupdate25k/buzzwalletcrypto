// Connects the user's BEP20 (BNB Smart Chain) address through WalletConnect, opening Trust Wallet.
// We only ask for the address. No transaction permission is requested.
const SDK_URL = "https://esm.sh/@walletconnect/sign-client@2";
const BSC = "eip155:56";
let clientPromise = null;

function getClient(projectId) {
  if (!clientPromise) {
    clientPromise = (async () => {
      let mod;
      try {
        mod = await import(SDK_URL);
      } catch (e) {
        throw new Error("Couldn't load the wallet connector. Check your internet and try again.");
      }
      const SignClient = mod.SignClient || (mod.default && mod.default.SignClient) || mod.default;
      return SignClient.init({
        projectId,
        metadata: {
          name: "Buzz Wallet",
          description: "Connect your BEP20 wallet",
          url: window.location.origin,
          icons: []
        }
      });
    })().catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

// Universal link that opens Trust Wallet and hands it the WalletConnect request.
export const trustLink = (uri) => "https://link.trustwallet.com/wc?uri=" + encodeURIComponent(uri);

function friendly(err) {
  const m = String((err && err.message) || err || "");
  if (/reject|declin|denied|cancel/i.test(m)) return "The connection was declined in the wallet.";
  if (/expire|timeout|timed out/i.test(m)) return "The connection request expired. Please try again.";
  if (/project|unauthori[sz]ed|origin|allowlist/i.test(m)) return "Wallet connection isn't set up correctly. Please contact the admin.";
  return m || "Could not connect the wallet.";
}

// Resolves with the approved BEP20 address (lowercase 0x...). onUri gets the WalletConnect link once it exists.
export async function connectWallet(projectId, { onUri }) {
  try {
    const client = await getClient(projectId);
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        eip155: { methods: ["personal_sign"], chains: [BSC], events: ["chainChanged", "accountsChanged"] }
      }
    });
    if (!uri) throw new Error("Could not start the wallet connection.");
    onUri(uri);

    const session = await approval();
    const accounts = (session.namespaces && session.namespaces.eip155 && session.namespaces.eip155.accounts) || [];
    const match = accounts.find((a) => a.startsWith(BSC + ":")) || accounts[0] || "";
    const address = match.split(":")[2] || "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("The wallet did not return a BEP20 address.");

    // We only needed the address. Close the session so nothing stays connected.
    try { await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "Done" } }); } catch (e) { /* fine */ }
    return address.toLowerCase();
  } catch (e) {
    throw new Error(friendly(e));
  }
}
