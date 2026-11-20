import { readFileSync } from 'fs';

const raw = JSON.parse(readFileSync('src/session.json','utf-8'));
const acc = Array.isArray(raw) ? raw[0] : raw;

// Decode composite xo
const parts = acc.xo.split('.');
const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

console.log('=== SESSION ANALYSIS ===');
console.log('user_id    :', acc.user_id);
console.log('phone      :', acc.phone || acc.mobile);
console.log('gaid       :', acc.gaid || acc.identity?.gaid);
console.log('instance_id:', acc.instance_id || acc.identity?.instance_id);
console.log('xo length  :', acc.xo.length, 'chars');
console.log('ox length  :', acc.ox.length, 'chars');
console.log('\n=== DECODED XO PAYLOAD ===');
console.log(JSON.stringify(payload, null, 2));

// JWT expiry
const jwtParts = payload.jwt.split('.');
const jwtPayload = JSON.parse(Buffer.from(jwtParts[1] + '==', 'base64').toString());
const now = Math.floor(Date.now()/1000);
console.log('\n=== JWT EXPIRY ===');
console.log('exp     :', new Date(jwtPayload.exp * 1000).toISOString());
console.log('valid   :', now < jwtPayload.exp ? 'YES ✅' : 'EXPIRED ❌');
console.log('user_id :', jwtPayload['https://meesho.com/user_id']);
console.log('\n=== WHAT TO USE AS HEADERS ===');
console.log('Authorization (inner JWT):', payload.jwt.slice(0,60)+'…');
console.log('Xo (hex from payload)    :', payload.xo);
console.log('X-Access-Token (ox)      :', acc.ox.slice(0,40)+'…');

