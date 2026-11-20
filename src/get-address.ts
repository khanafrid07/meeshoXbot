import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

function getSessionData() {
    const candidatePaths = [
        'ORD-2610-0289.txt',
        'session.json',
        '5_6316682945679597997.json',
        path.join('src', 'ORD-2610-0289.txt'),
        path.join('src', 'session.json'),
        path.join('src', '5_6316682945679597997.json'),
        path.join('..', 'ORD-2610-0289.txt'),
        path.join('..', 'session.json'),
        path.join('..', '5_6316682945679597997.json'),
    ];

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data[0] : data;
        }
    }
    throw new Error('No session JSON file found.');
}

async function findWorkingAddressRoute() {
    const sessionData = getSessionData();

    // Decode composite xo → extract inner JWT and xo hex
    // composite = base64({"type":"composite"}).base64({"jwt":"<signed>","xo":"<hex>"})
    let innerJwt = '';
    let xoHex = '';
    if (sessionData.xo) {
        try {
            const parts = sessionData.xo.split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
            innerJwt = payload.jwt || '';
            xoHex = payload.xo || '';
        } catch {
            innerJwt = sessionData.xo;
        }
    }

    const gaid = sessionData.identity?.gaid || sessionData.gaid || '';
    const dalvikUa = sessionData.identity?.dalvik_ua || 'okhttp/4.9.0';
    const instanceId = sessionData.identity?.instance_id || sessionData.instance_id || '';

    console.log(`🔑 Authorization (inner JWT): ${innerJwt.slice(0,40)}…`);
    console.log(`🔑 Xo (hex): ${xoHex}`);
    console.log(`🔑 ox: ${(sessionData.ox||'').slice(0,30)}…`);

    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': dalvikUa,
        'APP-CLIENT-ID': 'android',
        'APP-SDK-VERSION': '28',
        'Application-Id': 'com.meesho.supply',
        'App-Version': '29.9',
        'Authorization': innerJwt,
        'Xo': xoHex,
        'xo': xoHex,
        'X-Access-Token': sessionData.ox || '',
        'ox': sessionData.ox || '',
        'APP-GAID': gaid,
        'X-User-Id': String(sessionData.user_id || ''),
        'X-Instance-Id': instanceId,
        'MEESHO-USER-CONTEXT': 'logged_in',
    };

    // Candidates based on Retrofit interface paths + Meesho microservice gateway prefixes
    const candidates = [
        // 1. Direct gateway routes with query
        { name: "2.0/addresses (with context=cart)", url: "https://prod.meeshoapi.com/2.0/addresses?context=cart&check_pin=false" },
        { name: "2.0/addresses (with context=DEFAULT)", url: "https://prod.meeshoapi.com/2.0/addresses?context=DEFAULT&check_pin=false" },
        { name: "3.0/addresses (with context=cart)", url: "https://prod.meeshoapi.com/3.0/addresses?context=cart&check_pin=false" },

        // 2. Sub-path prefixed gateways on prod.meeshoapi.com
        { name: "address/2.0/addresses", url: "https://prod.meeshoapi.com/address/2.0/addresses?context=cart&check_pin=false" },
        { name: "address/3.0/addresses", url: "https://prod.meeshoapi.com/address/3.0/addresses?context=cart&check_pin=false" },
        { name: "1.0/address", url: "https://prod.meeshoapi.com/1.0/address" },
        { name: "1.0/addresses", url: "https://prod.meeshoapi.com/1.0/addresses" },

        // 3. User / checkout prefix on prod.meeshoapi.com
        { name: "user/2.0/addresses", url: "https://prod.meeshoapi.com/user/2.0/addresses?check_pin=false" },
        { name: "checkout/2.0/addresses", url: "https://prod.meeshoapi.com/1.0/checkout/addresses" },

        // 4. Edge domain (edge.meesho.com)
        { name: "edge: 2.0/addresses", url: "https://edge.meesho.com/2.0/addresses?check_pin=false" },
        { name: "edge: 3.0/addresses", url: "https://edge.meesho.com/3.0/addresses?context=cart&check_pin=false" },
        { name: "edge: address/2.0/addresses", url: "https://edge.meesho.com/address/2.0/addresses" },

        // 5. Web API domain
        { name: "web: api/v1/addresses", url: "https://www.meesho.com/api/v1/addresses" },
        { name: "web: api/v2/addresses", url: "https://www.meesho.com/api/v2/addresses" },
    ];

    console.log("🔍 Scanning candidate Meesho Address routes using your authenticated session...\n");

    for (const item of candidates) {
        try {
            process.stdout.write(`⏳ Probing [${item.name}] ... `);
            const res = await axios.get(item.url, { headers, timeout: 6000 });

            console.log(`✅ SUCCESS (${res.status})!`);
            console.log("\n🎯 MATCH FOUND ON URL:", item.url);
            console.log("📦 Response Data:\n", JSON.stringify(res.data, null, 2));
            return;
        } catch (err: any) {
            const status = err.response?.status;
            const dataMsg = err.response?.data?.message || err.response?.data?.error || err.message;

            if (status === 404) {
                console.log(`❌ 404 (Route not found)`);
            } else if (status === 401 || status === 403) {
                console.log(`⚠️ HTTP ${status} (Route exists, but auth rejected: ${dataMsg})`);
            } else if (status === 400) {
                console.log(`⚠️ HTTP 400 (Route exists, query params or body needed: ${dataMsg})`);
                console.log("Response:", err.response?.data);
            } else {
                console.log(`❌ Error: ${dataMsg}`);
            }
        }
    }

    console.log("\n⚠️ None of the standard guessed routes matched.");
    console.log("💡 Tip: In JADX, right click 'AddressesService' -> 'Find Usages' to see the exact Retrofit baseUrl!");
}

findWorkingAddressRoute();
