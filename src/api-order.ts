import axios from 'axios';
import fs from 'fs';
import path from 'path';

function loadSessionData() {
    const candidatePaths = [
        'session.json',
        '5_6316682945679597997.json',
        'session_6743229544.json',
        path.join('src', 'session.json'),
        path.join('src', '5_6316682945679597997.json'),
        path.join('src', 'session_6743229544.json'),
    ];

    const foundPath = candidatePaths.find(p => fs.existsSync(p));
    if (!foundPath) {
        throw new Error("No session JSON file found in root or src/ directory.");
    }

    console.log(`📂 Using session file: ${foundPath}`);
    const raw = fs.readFileSync(foundPath, 'utf-8');
    return JSON.parse(raw);
}

async function placeMeeshoOrder() {
    try {
        // 1. Load session JSON containing token and identity data
        const sessionData = loadSessionData();
        const { xo, ox, user_id, phone, mobile, instance_id, gaid, identity } = sessionData;

        const effectiveInstanceId = instance_id || identity?.instance_id || '';
        const effectiveGaid = gaid || identity?.gaid || '';
        const effectiveAndroidId = identity?.android_id || '';
        const effectiveAppSessionId = identity?.app_session_id || '';
        const effectiveUserAgent = identity?.dalvik_ua || 'okhttp/4.9.0';
        const userPhone = phone || mobile || '';

        console.log(`👤 Loaded session for User ID: ${user_id || 'N/A'} | Phone: ${userPhone}`);

        // 2. Decode composite xo token to extract inner JWT and xo hex
        // composite = base64({"type":"composite"}).base64({"jwt":"<signed-jwt>","xo":"<hex>"})
        let innerJwt = xo || '';
        let xoHex = '';
        try {
            const parts = (xo || '').split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
            innerJwt = payload.jwt || xo || '';
            xoHex = payload.xo || '';
        } catch { /* keep defaults */ }

        // 3. Map standard authenticated headers matching the official Meesho Android app client
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': effectiveUserAgent,
            'APP-CLIENT-ID': 'android',
            'APP-SDK-VERSION': '28',
            'Application-Id': 'com.meesho.supply',
            'App-Version': '29.9',
            // Authorization = inner signed JWT (extracted from composite xo)
            'Authorization': innerJwt,
            // Xo = short hex string from composite payload
            'Xo': xoHex,
            'xo': xoHex,
            // ox = the long access token
            'X-Access-Token': ox || '',
            'ox': ox || '',
            'X-User-Id': String(user_id || ''),
            'X-Instance-Id': effectiveInstanceId,
            'X-Gaid': effectiveGaid,
            'APP-GAID': effectiveGaid,
            'X-Android-Id': effectiveAndroidId,
            'X-App-Session-Id': effectiveAppSessionId,
            'MEESHO-USER-CONTEXT': 'logged_in',
        };

        // 3. Define target payload (Product ID, Variant/Size, Address ID, and Payment mode)
        const orderPayload = {
            product_id: 12345678,
            product_variant_id: 87654321,
            address_id: "your_saved_address_id",
            payment_mode: "ONLINE_PAID"
        };

        console.log("🚀 Dispatching direct API order request to Meesho gateway...");

        // 4. Hit the core production endpoint directly
        const response = await axios.post(
            'https://prod.meeshoapi.com/api/v1/order/checkout',
            orderPayload,
            { headers }
        );

        console.log("✅ Order Placed Successfully:", response.data);
    } catch (error: any) {
        if (error.response) {
            console.error(`❌ API Order Failed with HTTP status ${error.response.status}:`);
            console.error("Response data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("❌ Request Error:", error.message);
        }
    }
}

placeMeeshoOrder();
