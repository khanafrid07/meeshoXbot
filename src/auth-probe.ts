/**
 * auth-probe.ts  —  runs EVERY auth combo against MULTIPLE endpoints
 * Run with real internet: npx tsx src/auth-probe.ts
 */
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

function loadSession() {
    const candidates = [
        'session.json', 'session_6743229544.json', '5_6316682945679597997.json',
        path.join('src', 'session.json'), path.join('src', 'session_6743229544.json'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            const raw = JSON.parse(fs.readFileSync(c, 'utf-8'));
            return Array.isArray(raw) ? raw[0] : raw;
        }
    }
    throw new Error('No session file found');
}

function decodeXo(xo: string) {
    try {
        const parts = xo.split('.');
        const payload = JSON.parse(Buffer.from(parts[1] as string, 'base64').toString('utf-8'));
        return { innerJwt: payload.jwt as string, xoHex: payload.xo as string };
    } catch { return { innerJwt: xo, xoHex: '' }; }
}

async function probe() {
    const acc = loadSession();
    const { innerJwt, xoHex } = decodeXo(acc.xo);
    const compositeXo: string = acc.xo;
    const ox: string = acc.ox;
    const gaid: string = acc.identity?.gaid || acc.gaid || '';
    const instanceId: string = acc.identity?.instance_id || acc.instance_id || '';
    const dalvikUa: string = acc.identity?.dalvik_ua || 'okhttp/4.9.0';
    const androidId: string = acc.identity?.android_id || '';

    console.log('\n📋 Tokens:');
    console.log('  compositeXo :', compositeXo.slice(0, 60) + '…');
    console.log('  innerJwt    :', innerJwt.slice(0, 60) + '…');
    console.log('  xoHex       :', xoHex);
    console.log('  ox          :', ox.slice(0, 40) + '…');
    console.log('  gaid        :', gaid);
    console.log('  instanceId  :', instanceId);
    console.log('  androidId   :', androidId);
    console.log();

    const baseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': dalvikUa,
        'APP-CLIENT-ID': 'android',
        'APP-SDK-VERSION': '28',
        'Application-Id': 'com.meesho.supply',
        'App-Version': '29.9',
        'APP-GAID': gaid,
        'X-Gaid': gaid,
        'X-User-Id': String(acc.user_id || ''),
        'X-Instance-Id': instanceId,
        'X-Android-Id': androidId,
        'MEESHO-USER-CONTEXT': 'logged_in',
        'X-Request-Time': String(Date.now()),
    };

    // All 15 auth combos
    const authCombos = [
        // Format: [label, Authorization, Xo/xo, X-Access-Token/ox]
        ['compositeXo | xoHex | ox',              compositeXo,            xoHex,       ox],
        ['compositeXo | compositeXo | ox',         compositeXo,            compositeXo, ox],
        ['innerJwt | xoHex | ox',                  innerJwt,               xoHex,       ox],
        ['innerJwt | compositeXo | ox',            innerJwt,               compositeXo, ox],
        ['Bearer innerJwt | xoHex | ox',           `Bearer ${innerJwt}`,   xoHex,       ox],
        ['Bearer innerJwt | compositeXo | ox',     `Bearer ${innerJwt}`,   compositeXo, ox],
        ['ox | compositeXo | ox',                  ox,                     compositeXo, ox],
        ['Bearer ox | compositeXo | ox',           `Bearer ${ox}`,         compositeXo, ox],
        ['xoHex | compositeXo | ox',               xoHex,                  compositeXo, ox],
        ['compositeXo | xoHex | innerJwt',         compositeXo,            xoHex,       innerJwt],
        ['innerJwt | xoHex | innerJwt',            innerJwt,               xoHex,       innerJwt],
        ['compositeXo | xoHex | xoHex',            compositeXo,            xoHex,       xoHex],
        ['Bearer compositeXo | xoHex | ox',        `Bearer ${compositeXo}`,xoHex,       ox],
        ['(empty auth) | compositeXo | ox',        '',                     compositeXo, ox],
        ['xoHex | xoHex | ox',                     xoHex,                  xoHex,       ox],
    ] as const;

    // Multiple endpoints to try (prod.meeshoapi.com + others bots might use)
    const endpoints = [
        'https://prod.meeshoapi.com/3.0/addresses?check_pin=false',
        'https://prod.meeshoapi.com/2.0/addresses?check_pin=false&context=DEFAULT',
        'https://prod.meeshoapi.com/1.0/user/profile',
        'https://prod.meeshoapi.com/1.0/users/profile',
        'https://prod.meeshoapi.com/api/1.0/user/profile',
        'https://prod.meeshoapi.com/api/1.0/cart',
    ];

    console.log(`🔍 Testing ${authCombos.length} auth combos × ${endpoints.length} endpoints\n`);
    console.log('─'.repeat(90));

    let found = false;

    for (const endpoint of endpoints) {
        console.log(`\n📡 Endpoint: ${endpoint}`);
        for (const [label, auth, xoH, xoAcc] of authCombos) {
            const headers: Record<string, string> = {
                ...baseHeaders,
                'Xo': xoH as string,
                'xo': xoH as string,
                'X-Access-Token': xoAcc as string,
                'ox': xoAcc as string,
            };
            if (auth) headers['Authorization'] = auth as string;

            try {
                const res = await axios.get(endpoint, { headers, timeout: 7000 });
                console.log(`\n✅✅✅ SUCCESS [HTTP ${res.status}]`);
                console.log(`   ENDPOINT     : ${endpoint}`);
                console.log(`   AUTH COMBO   : ${label}`);
                console.log(`   Authorization: ${(auth as string).slice(0, 60)}…`);
                console.log(`   Xo           : ${(xoH as string).slice(0, 60)}`);
                console.log(`   X-Access-Token: ${(xoAcc as string).slice(0, 40)}…`);
                console.log(`   RESPONSE     : ${JSON.stringify(res.data).slice(0, 300)}`);
                found = true;
                break;
            } catch (err: any) {
                const status = err.response?.status ?? 'NET';
                const msg = (err.response?.data?.error || err.response?.data?.message || err.message || '').slice(0, 60);
                process.stdout.write(`  ❌ [${status}] ${(label as string).padEnd(45)} → ${msg}\n`);
            }
        }
        if (found) break;
    }

    if (!found) {
        console.log('\n━'.repeat(90));
        console.log('⚠️  ALL 90 COMBINATIONS FAILED.');
        console.log('\n💡 This means one of:');
        console.log('   1. Your PC IP is blocked (token is device-locked to phone IP)');
        console.log('      → Try running this script while your PC is connected to your PHONE\'S hotspot');
        console.log('   2. Missing device signature header (HMAC/computed value from JADX interceptor)');
        console.log('      → In JADX, open com.meesho.core.impl.domain.c → find intercept() → check addHeader calls');
        console.log('   3. Session expired server-side even if JWT says valid');
        console.log('      → Export a fresh session and try again\n');
    }
}

probe().catch(console.error);
