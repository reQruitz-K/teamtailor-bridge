
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Verifies the TeamTailor webhook signature.
 * @param {Request} request 
 * @param {string} secret 
 * @returns {Promise<boolean>}
 */
export async function verifySignature(request, secret) {
    const signatureHeader = request.headers.get("X-TeamTailor-Signature");
    
    if (!signatureHeader) {
        return false;
    }

    // We clone because we need the raw text and the request might be read later (or already read).
    // caller should pass a clone if strict, but here we clone. 
    // WARN: If caller reads body later, they must use the cloned request or we must clone here from the start.
    // In index.js, we should probably pass the 'cloned' request or read text there.
    // Better: Helper takes the 'rawBody' string and the signature header.
    // But index.js streams...
    // Let's assume index.js calls this FIRST before consuming body.
    
    const bodyText = await request.clone().text(); 
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(bodyText);

    const key = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
    );

    // Calculate HMAC
    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        msgData
    );

    // Convert to hex
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // TeamTailor header might be just the hex, or t=...,v1=...
    // We check if our calculated signature exists in the header.
    return signatureHeader.includes(signatureHex);
}
