// M-Ai-L Box — Cloudflare Email Worker.
//
// Cloudflare Email Routing (catch-all rule → "Send to a Worker") hands every message for your
// domain to this Worker. It streams the raw RFC 5322 message to the M-Ai-L Box backend, signed
// with HMAC-SHA256 so the backend can reject forged or replayed requests.
//
// Required Worker settings (wrangler.toml [vars] / `wrangler secret put`):
//   INBOUND_URL            https://your-app-domain/api/inbound/raw
//   INBOUND_WEBHOOK_SECRET same value as INBOUND_WEBHOOK_SECRET in the backend .env  (use a secret!)
//
// Signature = hex(HMAC_SHA256(secret, `${timestamp}.${envelopeFrom}.${envelopeTo}.${sha256hex(body)}`))

const enc = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

export default {
  async email(message, env, ctx) {
    const body = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const from = message.from || "";
    const to = message.to || "";
    const bodyHash = hex(await crypto.subtle.digest("SHA-256", body));
    const signature = await sign(env.INBOUND_WEBHOOK_SECRET, `${timestamp}.${from}.${to}.${bodyHash}`);

    const res = await fetch(env.INBOUND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "message/rfc822",
        "X-Envelope-From": from,
        "X-Envelope-To": to,
        "X-Mailbox-Timestamp": timestamp,
        "X-Mailbox-Signature": signature,
      },
      body,
    });

    if (res.ok) return;
    // Permanent refusals are passed back to the sending server as an SMTP rejection (bounce).
    if (res.status === 404) return message.setReject("Mailbox does not exist or has expired");
    if (res.status === 413) return message.setReject("Message too large");
    if (res.status === 403) return message.setReject("Sender rejected");
    // Anything else (5xx, 401 misconfiguration, network) — fail the invocation so it is visible in
    // Workers logs. Verify with a test message how your sender reacts (see docs/DEPLOYMENT.md).
    throw new Error(`M-Ai-L Box inbound endpoint returned HTTP ${res.status}`);
  },
};
