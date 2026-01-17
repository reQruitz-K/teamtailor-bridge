
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Verifies the TeamTailor webhook signature.
 * @param {Request} request 
 * @param {string} secret 
 * @returns {Promise<boolean>}
 */
export async function verifySignature(request, secret) {
    let signatureHeader = request.headers.get("X-TeamTailor-Signature");
    
    // Fallback to 'tt-signature' (seen in logs)
    if (!signatureHeader) {
        signatureHeader = request.headers.get("tt-signature");
    }

    if (!signatureHeader) {
        return false;
    }

    const bodyText = await request.clone().text();

    // Handle Base64 encoded header (starts with 'dD0' which is 't=')
    if (signatureHeader.startsWith('dD0')) {
        try {
            signatureHeader = atob(signatureHeader);
            console.log(`[Webhook] Decoded Base64 Signature Header: ${signatureHeader}`);
        } catch (e) {
            console.error("[Webhook] Failed to decode Base64 signature header", e);
        }
    }

    // Check for V2 Timestamped Signature (t=...,v2=...)
    const tMatch = signatureHeader.match(/t=(\d+)/);
    const v2Match = signatureHeader.match(/v2=([a-f0-9]+)/);

    let msgData;
    let signatureHex;
    
    if (tMatch && v2Match) {
        const timestamp = tMatch[1];
        const v2Signature = v2Match[1];
        console.log(`[Webhook] Verifying V2 Signature. Timestamp: ${timestamp}`);
        
        // Standard Webhook Signing: timestamp + "." + body
        const encoder = new TextEncoder();
        msgData = encoder.encode(`${timestamp}.${bodyText}`);
        
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        
        const signatureBuffer = await crypto.subtle.sign("HMAC", key, msgData);
        const signatureArray = Array.from(new Uint8Array(signatureBuffer));
        signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        console.log(` - Computed V2: ${signatureHex}`);
        console.log(` - Header V2:   ${v2Signature}`);
        
        if (signatureHex === v2Signature) return true;
    }

    // Fallback: Simple Body Signing (V1)
    const encoder = new TextEncoder();
    msgData = encoder.encode(bodyText);
    const keyData = encoder.encode(secret);

    const key = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", key, msgData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.log(`[Webhook] Verify:`);
    console.log(` - Header: ${signatureHeader}`);
    console.log(` - Computed: ${signatureHex}`);
    console.log(` - Secret: ${secret.substring(0, 5)}... (Length: ${secret.length})`);

    return signatureHeader.includes(signatureHex);
}
