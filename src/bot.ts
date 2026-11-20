import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { randomUUID } from 'crypto';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import { resolveProduct } from './product-helper.js';
import {
    getAllAccounts,
    getActiveAccount,
    saveAccount,
    switchActiveAccount,
    incrementAccountOrderCount,
    isMongoConnected
} from './account-manager.js';

dotenv.config();
if (!process.env.BOT_TOKEN) dotenv.config({ path: path.resolve('..', '.env') });
const BOT_TOKEN = process.env.BOT_TOKEN || '';
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN missing'); process.exit(1); }

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/afridXmeesho';

// Initialize MongoDB connection gracefully in background
if (MONGO_URI) {
    mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 })
        .then(() => console.log('🍃 Connected to MongoDB Cluster!'))
        .catch(err => console.log('⚠️ MongoDB connection notice (using local sync fallback):', err.message));
}

const H = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HTML = { parse_mode: 'HTML' as const };

function buildUToken(phone: string): string {
    const clean = phone.replace(/^\++/, '').replace(/^91/, '');
    return Buffer.from('+91' + clean).toString('base64');
}

export function parseSessionInput(text: string): any | null {
    const trimmed = text.trim();
    // 1. Try JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            const acc = Array.isArray(parsed) ? parsed[0] : parsed;
            if (acc?.xo || acc?.user_id) return acc;
        } catch { }
    }

    // 2. Try cURL command
    if (trimmed.includes('curl') || trimmed.includes('-H ')) {
        const acc: any = {};
        const getHeader = (name: string) => {
            const m = trimmed.match(new RegExp(`-H\\s+['"]${name}:\\s*([^'"]+)['"]`, 'i')) ||
                      trimmed.match(new RegExp(`['"]?${name}['"]?:\\s*['"]?([^'"]+)['"]?`, 'i'));
            return m?.[1] ? m[1].trim() : null;
        };

        const auth = getHeader('authorization');
        if (auth) acc.authorization = auth;

        const xo = getHeader('xo');
        if (xo) acc.xo = xo;

        const userId = getHeader('app-user-id');
        if (userId) acc.user_id = Number(userId);

        const instanceId = getHeader('instance-id');
        if (instanceId) acc.instance_id = instanceId;

        const sessionId = getHeader('app-session-id');
        if (sessionId) acc.app_session_id = sessionId;

        const uToken = getHeader('u-token');
        if (uToken) {
            acc.u_token = uToken;
            try {
                const dec = Buffer.from(uToken, 'base64').toString('utf8');
                acc.phone = dec;
                acc.mobile = dec.replace(/^\+91/, '');
            } catch { }
        }

        const bodyMatch = trimmed.match(/"user_id":\s*(\d+)/);
        if (bodyMatch && !acc.user_id) acc.user_id = Number(bodyMatch[1]);

        if (acc.xo) return acc;
    }
    return null;
}

async function loadSavedSession(telegramUserId?: number): Promise<any | null> {
    try {
        const active = await getActiveAccount(telegramUserId);
        if (active?.xo) return active;
        if (fs.existsSync('src/session_active.json')) {
            const raw = fs.readFileSync('src/session_active.json', 'utf8');
            const data = JSON.parse(raw);
            if (data?.xo) return data;
        }
    } catch { }
    return null;
}

function buildHeaders(acc: any, pincode = '272175', city = 'khalilabad', addressId: number | null = null): Record<string, string> {
    const rawPhone = String(acc.phone || acc.mobile || '').replace(/^\++/, '+');
    const userId = String(acc.user_id || acc.userId || '');
    const instanceId = acc.instance_id || acc.instanceId || acc.identity?.instance_id || '41f8f9039893bdfa06431ae1290fe7f1';
    const appSessionId = acc.app_session_id || acc.appSessionId || acc.identity?.app_session_id || randomUUID();
    const shieldSessionId = acc.shield_session_id || acc.identity?.shield_session_id || (acc.instance_id ? deriveShieldSession(userId, instanceId) : '');
    const uToken = acc.u_token || acc.uToken || buildUToken(rawPhone);

    const locJson = JSON.stringify({
        lat: "26.712",
        long: "82.9793",
        pincode: pincode || "272175",
        city: city || "khalilabad",
        address_id: addressId ? String(addressId) : null
    });
    const appUserLocation = Buffer.from(locJson).toString('base64');

    return {
        'authorization': acc.authorization || '32c4d8137cn9eb493a1921f203173080',
        'xo': acc.xo,
        'app-version': '30.0',
        'app-version-code': '880',
        'app-sdk-version': '32',
        'app-client-id': 'android',
        'application-id': 'com.meesho.supply',
        'instance-id': instanceId,
        'app-session-id': appSessionId,
        'shield-session-id': shieldSessionId,
        'app-user-id': userId,
        'u-token': uToken,
        'app-user-location': appUserLocation,
        'country-iso': 'in',
        'app-iso-language-code': 'en',
        'meesho-user-context': 'logged_in',
        'content-type': 'application/json; charset=UTF-8',
        'user-agent': 'okhttp/4.9.0',
        'accept-encoding': 'gzip',
        'priority': 'u=1, i'
    };
}

/**
 * Derives a stable shield session ID from user_id + instance_id.
 * This is a 32-char hex string matching Meesho Shield's expected format.
 */
function deriveShieldSession(userId: any, instanceId: string): string {
    const seed = String(userId || '') + (instanceId || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    // Pad with instanceId characters to reach 32 chars
    const base = h.toString(16).padStart(8, '0');
    const ext = (instanceId || '00000000000000000000000000000000').replace(/-/g, '').slice(0, 24);
    return (base + ext).slice(0, 32);
}


async function refreshXo(acc: any): Promise<string | null> {
    const uid = Number(acc.user_id || acc.userId);
    if (!acc.ox || !uid) return null;
    try {
        console.log('🔄 Attempting to refresh xo token using ox...');
        const h = buildHeaders(acc);
        const res = await axios.post('https://prod.meeshoapi.com/api/2.0/xo', {
            ox: acc.ox,
            user_id: uid
        }, {
            headers: h,
            timeout: 10000
        });
        const newXo = res.data?.xoox?.xo || res.data?.xo || res.data?.data?.xo;
        if (newXo) {
            console.log('✅ xo token refreshed successfully!');
            acc.xo = newXo;
            try {
                fs.writeFileSync('src/session_active.json', JSON.stringify(acc, null, 2));
            } catch { }
            return newXo;
        }
    } catch (e: any) {
        console.log('xo refresh failed:', e.response?.status, e.response?.data || e.message);
    }
    return null;
}

interface SavedAddr {
    id: number;
    name: string;
    mobile: string;
    city: string;
    pin: string;
    address_line_1: string;
    pin_serviceable?: boolean;
}

interface WizardState extends Scenes.WizardSessionData {
    account?: any;
    productId?: number;
    variantId?: number;
    supplierId?: number;
    variationName?: string;
    productTitle?: string;
    price?: number | undefined;
    mrp?: number | undefined;
    savedAddresses?: SavedAddr[];
    addressId?: number;
    pin?: string;
    addrName?: string;
    addrPhone?: string;
    addrLine1?: string;
    addrLine2?: string;
    addrCity?: string;
    addrState?: string;
    paymentMethod?: 'upi' | 'cod';
}
interface BotCtx extends Scenes.WizardContext<WizardState> { }

async function handleProductResolution(ctx: BotCtx, input: string): Promise<any> {
    if (!input) {
        await ctx.reply('❌ Please send a Meesho product URL or numeric Product ID:');
        return;
    }

    await ctx.reply('⏳ Resolving product variants & supplier info from Meesho...', HTML);

    try {
        const acc = ctx.scene.session.account;
        const resolved = await resolveProduct(input, buildHeaders(acc));

        ctx.scene.session.productId = resolved.productId;
        ctx.scene.session.variantId = resolved.variationId;
        ctx.scene.session.supplierId = resolved.supplierId;
        ctx.scene.session.variationName = resolved.variation;
        ctx.scene.session.productTitle = resolved.productTitle;
        ctx.scene.session.price = resolved.price;
        ctx.scene.session.mrp = resolved.mrp;

        const addrs = ctx.scene.session.savedAddresses || [];
        let addrMsg = `📦 <b>Product:</b> ${H(resolved.productTitle)}\n`;
        if (resolved.price) {
            const discount = (resolved.mrp && resolved.mrp > resolved.price) ? resolved.mrp - resolved.price : 0;
            addrMsg += `💰 <b>Price:</b> ₹${resolved.price}` + (discount > 0 ? ` (MRP: ₹${resolved.mrp}, Save ₹${discount})` : '') + '\n';
        }
        addrMsg += `🏷️ <b>Variant:</b> ${H(resolved.variation)} (ID: <code>${resolved.variationId}</code>)\n` +
            `🏬 <b>Supplier:</b> <code>${resolved.supplierId || 'Default'}</code>\n\n` +
            `🏠 <b>Step 3 — Address Selection</b>\n\n`;

        if (addrs.length > 0) {
            addrMsg += 'Saved addresses found:\n';
            addrs.slice(0, 5).forEach((a, i) => {
                const unserv = a.pin_serviceable === false ? ' ⚠️ <b>[Unserviceable Pincode]</b>' : '';
                addrMsg += `<b>[${i + 1}]</b> ${H(a.name)} (${H(a.mobile)}) - ${H(a.address_line_1)}, ${H(a.city)} (${H(a.pin)})${unserv}\n`;
            });
            addrMsg += `\nReply with a number (<b>1 to ${Math.min(addrs.length, 5)}</b>) to use a saved address,\nOR type <b>new</b> to enter a new address:`;
        } else {
            addrMsg += 'No saved address found.\nPlease enter <b>Recipient Full Name</b>:';
        }

        await ctx.reply(addrMsg, HTML);
        return ctx.wizard.next();
    } catch (err: any) {
        await ctx.reply(`❌ <b>Product Resolution Failed:</b>\n<pre>${H(err.message || String(err))}</pre>\n\nPlease check the link or send numeric Product ID:`, HTML);
        return;
    }
}

const orderWizard = new Scenes.WizardScene<BotCtx>(
    'ORDER_WIZARD',

    // Step 0: Check saved session or request login
    async (ctx) => {
        const telegramUserId = ctx.from?.id;
        const saved = await loadSavedSession(telegramUserId);
        if (saved?.xo || saved?.ox) {
            if (saved.ox) {
                await refreshXo(saved);
            }
            ctx.scene.session.account = saved;
            const phone = saved.phone || saved.mobile || saved.user_id;
            await ctx.reply(`✅ <b>Active Session:</b> <code>${H(phone)}</code>\n\n⏳ Loading saved addresses...\n\n<i>(Type /accounts to switch or manage accounts anytime)</i>`, HTML);

            try {
                const h = buildHeaders(saved);
                const addrRes = await axios.get('https://prod.meeshoapi.com/api/3.0/addresses', {
                    params: { offset: 0, limit: 50, check_pin: true, context: 'cart', cart_identifier: 'buy_now' },
                    headers: h,
                    timeout: 8000
                });
                ctx.scene.session.savedAddresses = addrRes.data?.addresses || [];
            } catch (e: any) {
                console.log('Saved addresses lookup error:', e.response?.data || e.message);
                ctx.scene.session.savedAddresses = [];
            }

            await ctx.reply('📦 <b>Step 2 — Product Link</b>\n\nSend a Meesho product URL or numeric Product ID:', HTML);
            return ctx.wizard.selectStep(2); // Jump directly to Step 2 (Product resolution)!
        }

        await ctx.reply('🔑 <b>Step 1 — Login / Add Account</b>\n\nPaste your Meesho session JSON or cURL command here:', HTML);
        return ctx.wizard.next(); // Go to Step 1 to wait for login input
    },

    // Step 1: Validate session & fetch saved addresses (only runs if no saved session)
    async (ctx) => {
        const text = ctx.text?.trim() || '';

        const acc = parseSessionInput(text);
        if (!acc || (!acc.xo && !acc.ox)) {
            await ctx.reply('❌ Invalid format. Please paste a valid session JSON or cURL command.');
            return;
        }

        if (acc.ox) {
            await refreshXo(acc);
        }

        const telegramUserId = ctx.from?.id;
        const savedAccount = await saveAccount(acc, telegramUserId);
        ctx.scene.session.account = savedAccount;

        const phone = savedAccount.phone || savedAccount.mobile || savedAccount.userId;
        await ctx.reply(`✅ <b>Account Saved & Activated:</b> <code>${H(phone)}</code>\n\n⏳ Loading saved addresses...`, HTML);

        try {
            const h = buildHeaders(acc);
            const addrRes = await axios.get('https://prod.meeshoapi.com/api/3.0/addresses', {
                params: { offset: 0, limit: 50, check_pin: true, context: 'cart', cart_identifier: 'buy_now' },
                headers: h,
                timeout: 8000
            });
            ctx.scene.session.savedAddresses = addrRes.data?.addresses || [];
        } catch (e: any) {
            console.log('Saved addresses lookup error:', e.response?.data || e.message);
            ctx.scene.session.savedAddresses = [];
        }

        await ctx.reply('📦 <b>Step 2 — Product Link</b>\n\nSend a Meesho product URL or numeric Product ID:', HTML);
        return ctx.wizard.next(); // Advance to Step 2
    },

    // Step 2: Resolve product & address selection
    async (ctx) => {
        const input = ctx.text?.trim() || '';
        // If user wants to switch session here, handle it:
        if (input.startsWith('{') || input.includes('curl') || input.includes('-H \'xo:')) {
            const newAcc = parseSessionInput(input);
            if (newAcc?.xo || newAcc?.ox) {
                if (newAcc.ox) {
                    await refreshXo(newAcc);
                }
                const savedAcc = await saveAccount(newAcc, ctx.from?.id);
                ctx.scene.session.account = savedAcc;

                try {
                    const h = buildHeaders(newAcc);
                    const addrRes = await axios.get('https://prod.meeshoapi.com/api/3.0/addresses', {
                        params: { offset: 0, limit: 50, check_pin: true, context: 'cart', cart_identifier: 'buy_now' },
                        headers: h,
                        timeout: 8000
                    });
                    ctx.scene.session.savedAddresses = addrRes.data?.addresses || [];
                } catch (e: any) {
                    console.log('Saved addresses lookup error after switch:', e.response?.data || e.message);
                    ctx.scene.session.savedAddresses = [];
                }

                await ctx.reply(`✅ <b>Switched Account:</b> <code>${H(newAcc.phone || newAcc.user_id)}</code>\n\nNow send the Meesho product link:`, HTML);
                return;
            }
        }
        return await handleProductResolution(ctx, input);
    },

    // Step 3: Handle address choice or first field of new address
    async (ctx) => {
        const input = ctx.text?.trim() || '';
        const addrs = ctx.scene.session.savedAddresses || [];

        const idx = Number(input) - 1;
        if (/^[1-5]$/.test(input) && addrs[idx]) {
            const selected = addrs[idx]!;
            if (selected.pin_serviceable === false) {
                await ctx.reply(`❌ <b>Address Unserviceable:</b>\nPincode <code>${selected.pin}</code> for <i>${H(selected.city)}</i> is marked as non-serviceable for delivery by Meesho.\n\nPlease choose another address or type <b>new</b> to enter a serviceable delivery address:`, HTML);
                return;
            }
            ctx.scene.session.addressId = selected.id;
            ctx.scene.session.pin = selected.pin;
            ctx.scene.session.addrCity = selected.city;

            await ctx.reply(
                `💳 <b>Step 4 — Select Payment Method</b>\n\n` +
                `[1] 📱 <b>Online UPI QR Code</b> (Recommended — Pay via PhonePe / GPay / Paytm)\n` +
                `[2] 💵 <b>Cash on Delivery (COD)</b>\n\n` +
                `Reply with <b>1</b> for Online UPI QR or <b>2</b> for COD <i>(or just press 1)</i>:`,
                HTML
            );
            return ctx.wizard.selectStep(10);
        }

        if (input.toLowerCase() === 'new' && addrs.length > 0) {
            await ctx.reply('Enter <b>Recipient Full Name</b>:', HTML);
            return;
        }

        ctx.scene.session.addrName = input;
        await ctx.reply('Enter <b>10-digit Phone Number</b>:', HTML);
        return ctx.wizard.next();
    },

    // Step 4: New address phone
    async (ctx) => {
        const phone = ctx.text?.trim().replace(/^\+?91/, '') || '';
        if (!/^\d{10}$/.test(phone)) {
            await ctx.reply('❌ Enter a valid 10-digit phone number:');
            return;
        }
        ctx.scene.session.addrPhone = phone;
        await ctx.reply('Enter <b>House / Building / Line 1</b>:', HTML);
        return ctx.wizard.next();
    },

    // Step 5: New address line 1
    async (ctx) => {
        ctx.scene.session.addrLine1 = ctx.text?.trim() || '';
        await ctx.reply('Enter <b>Road / Locality / Line 2</b> (or type - to skip):', HTML);
        return ctx.wizard.next();
    },

    // Step 6: New address line 2
    async (ctx) => {
        const l2 = ctx.text?.trim() || '';
        ctx.scene.session.addrLine2 = l2 === '-' ? '' : l2;
        await ctx.reply('Enter <b>City</b>:', HTML);
        return ctx.wizard.next();
    },

    // Step 7: New address city
    async (ctx) => {
        ctx.scene.session.addrCity = ctx.text?.trim() || '';
        await ctx.reply('Enter <b>State</b> (e.g. Uttar Pradesh):', HTML);
        return ctx.wizard.next();
    },

    // Step 8: New address state
    async (ctx) => {
        ctx.scene.session.addrState = ctx.text?.trim() || '';
        await ctx.reply('Enter <b>6-digit Pincode</b>:', HTML);
        return ctx.wizard.next();
    },

    // Step 9: Pincode -> Create address & Checkout
    async (ctx) => {
        const pin = ctx.text?.trim() || '';
        if (!/^\d{6}$/.test(pin)) {
            await ctx.reply('❌ Enter a valid 6-digit pincode:');
            return;
        }
        ctx.scene.session.pin = pin;

        const acc = ctx.scene.session.account;
        const headers = buildHeaders(acc, pin, ctx.scene.session.addrCity || 'khalilabad');

        await ctx.reply('📍 <b>[1/5]</b> Creating delivery address on Meesho...', HTML);

        try {
            const addrPayload = {
                alternative_mobile: null,
                pin: pin,
                address_type: "Home",
                city: ctx.scene.session.addrCity,
                name: ctx.scene.session.addrName,
                address_line_1: ctx.scene.session.addrLine1,
                address_line_2: ctx.scene.session.addrLine2 || "",
                mobile: ctx.scene.session.addrPhone,
                state: ctx.scene.session.addrState,
                id: 0,
                landmark: "",
                country_id: 1,
                user_id: Number(acc.user_id)
            };

            const addrRes = await axios.post(
                'https://prod.meeshoapi.com/api/2.0/addresses?context=cart&cart_identifier=buy_now',
                addrPayload,
                { headers }
            );

            const addrId = addrRes.data?.id || addrRes.data?.address?.id || addrRes.data?.data?.id;
            if (!addrId) throw new Error('Address ID missing in response');

            ctx.scene.session.addressId = addrId;
            await ctx.reply(`✅ Address created! ID: <code>${addrId}</code>`, HTML);
            await ctx.reply(
                `💳 <b>Step 4 — Select Payment Method</b>\n\n` +
                `[1] 📱 <b>Online UPI QR Code</b> (Recommended — Pay via PhonePe / GPay / Paytm)\n` +
                `[2] 💵 <b>Cash on Delivery (COD)</b>\n\n` +
                `Reply with <b>1</b> for Online UPI QR or <b>2</b> for COD <i>(or just press 1)</i>:`,
                HTML
            );
            return ctx.wizard.selectStep(10);
        } catch (err: any) {
            const errData = err.response?.data || err.message;
            await ctx.reply(`❌ <b>Address Creation Failed:</b>\n<pre>${H(JSON.stringify(errData, null, 2))}</pre>`, HTML);
            return ctx.scene.leave();
        }
    },

    // Step 10: Payment selection & trigger checkout
    async (ctx) => {
        const input = (ctx.text?.trim() || '').toLowerCase();
        if (input === '2' || input === 'cod' || input.includes('cash')) {
            ctx.scene.session.paymentMethod = 'cod';
        } else {
            // Default to online UPI QR
            ctx.scene.session.paymentMethod = 'upi';
        }
        return await runCheckoutPipeline(ctx);
    }
);

function saveOrder(order: any) {
    try {
        let orders: any[] = [];
        if (fs.existsSync('orders.json')) {
            const raw = fs.readFileSync('orders.json', 'utf8');
            orders = JSON.parse(raw);
        }
        orders.unshift(order);
        fs.writeFileSync('orders.json', JSON.stringify(orders, null, 2));

        if (order.accountUserId) {
            incrementAccountOrderCount(Number(order.accountUserId)).catch(() => {});
        }
    } catch (e: any) {
        console.error('Failed to save order to orders.json:', e.message);
    }
}

interface ActivePaymentSession {
    orderNum: string;
    transactionId: string;
    cartSession: string;
    userId: number;
    headers: Record<string, string>;
    pollInterval?: NodeJS.Timeout;
    chatId?: number;
    customerAmount: number;
}
const activePayments = new Map<string, ActivePaymentSession>();

// ─── Automated Checkout Pipeline ──────────────────────────────────────────────
async function runCheckoutPipeline(ctx: any) {
    const s = ctx.scene.session;
    const acc = s.account;
    if (acc) {
        acc.user_id = Number(acc.user_id || acc.userId);
        acc.userId = acc.user_id;
        acc.phone = String(acc.phone || acc.mobile || acc.user_id).replace(/^\++/, '+');
        acc.instance_id = acc.instance_id || acc.instanceId || '41f8f9039893bdfa06431ae1290fe7f1';
        acc.app_session_id = acc.app_session_id || acc.appSessionId || '3ba68a88-09ae-42a0-a64e-968b01fac852';
    }
    let headers = buildHeaders(acc, s.pin || '272175', s.addrCity || 'khalilabad');
    let currentStepName = 'Cart Add';

    try {
        await ctx.reply('🛒 <b>[2/5]</b> Adding item to cart...', HTML);

        const priceTypes = ["basic_return_price", "premium_return_price", "all_return_price", null];
        let cartAdded = false;
        let lastError: any = null;
        let cartSession = "";

        for (const pType of priceTypes) {
            const cartAddPayload: any = {
                context: "pdp",
                identifier: "buy_now",
                cart_session: null,
                replaceable: false,
                items: [
                    {
                        identifier: "buy_now",
                        product_id: Number(s.productId),
                        supplier_id: Number(s.supplierId) > 0 ? Number(s.supplierId) : 2806087,
                        variation_id: Number(s.variantId) > 0 ? Number(s.variantId) : 167,
                        variation: s.variationName || "Free Size",
                        quantity: 1,
                        selected_price_type_id: pType,
                        client_metadata: null
                    }
                ],
                address_id: null,
                user_id: Number(acc.user_id)
            };
            if (!pType) delete cartAddPayload.items[0].selected_price_type_id;

            try {
                console.log(`Sending /api/1.0/cart/add with priceType=${pType}...`);
                const cartRes = await axios.post('https://prod.meeshoapi.com/api/1.0/cart/add', cartAddPayload, { headers });

                if (cartRes.data?.success === false) {
                    const err = cartRes.data?.error || {};
                    console.log(`Cart add returned error for priceType=${pType}:`, err);
                    if (err?.code === 'CART_OOS' || err?.title === 'Out of Stock') {
                        throw new Error(`📦 <b>Product Out of Stock:</b> ${err?.message || 'This product is currently out of stock on Meesho. Please try another product.'}`);
                    }
                    lastError = { response: { status: 400, data: err } };
                    continue;
                }

                const returnedSession = cartRes.data?.cart_session || cartRes.data?.data?.cart_session;
                if (!returnedSession) {
                    lastError = { response: { status: 400, data: cartRes.data } };
                    continue;
                }

                cartAdded = true;
                cartSession = returnedSession;
                console.log(`✅ Cart add succeeded with priceType: ${pType}!`);
                break;
            } catch (e: any) {
                if (e.message && e.message.includes('Product Out of Stock')) {
                    throw e;
                }
                lastError = e;
                console.log(`Cart add attempt with ${pType} failed (HTTP ${e.response?.status}):`, e.response?.data || e.message);

                if (e.response?.status === 401 && acc.ox) {
                    const refreshed = await refreshXo(acc);
                    if (refreshed) {
                        headers = buildHeaders(acc, s.pin || '272175', s.addrCity || 'khalilabad');
                        try {
                            const cartRes = await axios.post('https://prod.meeshoapi.com/api/1.0/cart/add', cartAddPayload, { headers });
                            if (cartRes.data?.success === false) {
                                const err = cartRes.data?.error || {};
                                if (err?.code === 'CART_OOS' || err?.title === 'Out of Stock') {
                                    throw new Error(`📦 <b>Product Out of Stock:</b> ${err?.message || 'This product is currently out of stock on Meesho. Please try another product.'}`);
                                }
                                lastError = { response: { status: 400, data: err } };
                            } else {
                                const returnedSession = cartRes.data?.cart_session || cartRes.data?.data?.cart_session;
                                if (returnedSession) {
                                    cartAdded = true;
                                    cartSession = returnedSession;
                                    break;
                                }
                            }
                        } catch (reErr: any) {
                            if (reErr.message && reErr.message.includes('Product Out of Stock')) throw reErr;
                            lastError = reErr;
                        }
                    }
                }
            }
        }

        if (!cartAdded || !cartSession) {
            const status = lastError?.response?.status || 'Unknown';
            const errorBody = lastError?.response?.data || lastError?.message;
            if (status === 401) {
                throw new Error(`Session Expired (HTTP 401). Meesho rejected the login token for +${String(acc.phone || acc.mobile || acc.user_id).replace(/^\++/, '')}. Please open this account in Meesho and export a fresh session.`);
            }
            const errMsg = typeof errorBody === 'object' ? (errorBody.message || errorBody.title || JSON.stringify(errorBody)) : String(errorBody);
            throw new Error(`Cart Add Failed: ${errMsg}`);
        }

        headers = buildHeaders(acc, s.pin || '272175', s.addrCity || 'khalilabad', s.addressId);

        // 2. Select Address Delivery Location
        currentStepName = 'POST /api/1.0/user/delivery-location';
        await ctx.reply('📍 <b>[3/5]</b> Binding delivery address to cart...', HTML);
        try {
            await axios.post('https://prod.meeshoapi.com/api/1.0/user/delivery-location', {
                pincode: s.pin || "272175",
                context: "address_bottom_sheet_summary",
                user_id: Number(acc.user_id)
            }, { headers });
        } catch (e: any) {
            console.log('User delivery-location notice:', e.response?.data || e.message);
        }

        // 3. Cart Location (Binds address into cart session)[cite: 24]
        currentStepName = 'POST /api/1.0/cart/location';
        const cartLocationPayload = {
            context: "review",
            identifier: "buy_now",
            cart_session: cartSession,
            dest_pin: s.pin || "272175",
            address_id: Number(s.addressId),
            customerAmount: null,
            payment_modes: null,
            replaceable: null,
            item: null,
            payment_instrument: null,
            bank_offers: null,
            filter_products: null,
            is_self_pickup: null,
            self_pickup_address: null,
            is_emi: null,
            user_id: Number(acc.user_id)
        };
        const locRes = await axios.post('https://prod.meeshoapi.com/api/1.0/cart/location', cartLocationPayload, { headers });
        if (locRes.data?.success === false) {
            const err = locRes.data?.error || {};
            throw new Error(`Delivery Location Error: ${err.message || err.title || JSON.stringify(err)}`);
        }
        if (locRes.data?.cart_session) cartSession = locRes.data.cart_session;

        // 4. Cart Review (/api/9.0/cart)
        currentStepName = 'POST /api/9.0/cart (Review)';
        const reviewPayload = {
            context: "review",
            identifier: "buy_now",
            cart_session: cartSession,
            dest_pin: s.pin || "272175",
            address_id: Number(s.addressId),
            customerAmount: null,
            payment_modes: null,
            replaceable: null,
            item: null,
            payment_instrument: null,
            bank_offers: null,
            filter_products: true,
            is_self_pickup: null,
            self_pickup_address: null,
            is_emi: null,
            user_id: Number(acc.user_id)
        };
        try {
            const revRes = await axios.post('https://prod.meeshoapi.com/api/9.0/cart', reviewPayload, { headers });
            if (revRes.data?.cart_session) cartSession = revRes.data.cart_session;
        } catch (e: any) {
            console.log('Cart review notice:', e.response?.data || e.message);
        }

        // 4b. Payment Options (/api/v1/list/payment-options) - Required by Android App flow
        try {
            const smsId = `l:m_${acc.user_id}:bn_${Date.now()}`;
            const optRes = await axios.post('https://prod.meeshoapi.com/api/v1/list/payment-options', {
                payment_identifier: 'checkout',
                checkout_identifier: 'buy_now',
                cart_session: cartSession,
                sms_id: smsId,
                order_total: 0,
                available_upi_apps: [],
                skip_bnpl_eligibility: false,
                user_id: Number(acc.user_id)
            }, {
                headers: { ...headers, 'line-of-business': 'MEESHO_MARKETPLACE' }
            });
            if (optRes.data?.cart_session) cartSession = optRes.data.cart_session;
        } catch (optErr: any) {
            console.log('Payment options notice:', optErr.response?.data || optErr.message);
        }

        // 5. Payment Info
        currentStepName = 'POST /api/1.0/cart/paymentinfo';
        await ctx.reply('💳 <b>[4/5]</b> Fetching payment & billing details...', HTML);
        
        let isCOD = s.paymentMethod === 'cod';

        const paymentInstrument = isCOD ? null : {
            payment_method_type: "UPI",
            payment_method: "UPI",
            payment_aggregator: "MPS",
            payment_provider: "JUSPAY_S2S",
            processor_id: "internal_native",
            payment_card_type: "",
            payment_card_issuer: "",
            txn_type: "UPI_PAY",
            upi_app: "com.helper.upibridge",
            card_type: null,
            bank_code: null,
            card_bin: null,
            card_fingerprint: null,
            payment_method_fingerprint: null,
            issuing_card_bank: null
        };

        // Query paymentinfo with requested mode matching Meesho App
        const paymentInfoPayload = {
            context: "payment_summary",
            identifier: "buy_now",
            cart_session: cartSession,
            dest_pin: null,
            address_id: null,
            customerAmount: null,
            payment_modes: isCOD ? ["cod"] : ["online_v2"],
            replaceable: false,
            item: null,
            payment_instrument: paymentInstrument,
            bank_offers: null,
            filter_products: null,
            is_self_pickup: null,
            self_pickup_address: null,
            is_emi: null,
            user_id: Number(acc.user_id)
        };
        const payRes = await axios.post('https://prod.meeshoapi.com/api/1.0/cart/paymentinfo', paymentInfoPayload, { headers });
        if (payRes.data?.success === false) {
            const err = payRes.data?.error || {};
            throw new Error(`Payment Info Error: ${err.message || err.title || JSON.stringify(err)}`);
        }
        if (payRes.data?.cart_session) cartSession = payRes.data.cart_session;

        // Calculate amount accurately from Meesho paymentinfo result
        const resTotal = payRes.data?.result?.total || payRes.data?.result?.effective_total;
        const resPpd = payRes.data?.result?.effective_total_with_ppd;
        let customerAmount = isCOD 
            ? (resTotal || s.price || 0)
            : (resPpd || resTotal || s.price || 0);

        const paymentMethodLabel = isCOD ? '💵 Cash on Delivery (COD)' : '📱 Online UPI QR';

        // Payment Summary
        await ctx.reply(
            `💰 <b>Payment Summary</b>\n\n` +
            `📦 <b>Product:</b> ${H(s.productTitle || String(s.productId))}\n` +
            `🏷️ <b>Variant:</b> ${H(s.variationName || 'Free Size')}\n` +
            (s.mrp && s.price && s.mrp > s.price ? `🏷️ <b>MRP:</b> ₹${s.mrp}  →  <b>Price:</b> ₹${customerAmount} (Save ₹${s.mrp - customerAmount})\n` : '') +
            `💳 <b>Total Amount:</b> ₹${customerAmount}\n` +
            `🛍️ <b>Payment Mode:</b> ${paymentMethodLabel}\n` +
            `📍 <b>Delivery Address ID:</b> <code>${s.addressId}</code>`,
            HTML
        );

        // 6. Preorder Submission
        currentStepName = 'POST /api/4.0/preorders';
        await ctx.reply(`🚀 <b>[5/5]</b> Submitting final order via ${isCOD ? 'COD' : 'UPI QR'}...`, HTML);
        const preorderHeaders = {
            ...headers
        };

        const buildPreorderPayload = (asCOD: boolean, currentCartSession: string, amount: number) => {
            if (asCOD) {
                return {
                    payment_method_type: "COD",
                    identifier: "buy_now",
                    payment_aggregator: null,
                    is_selling_to_customer: false,
                    cart_session: currentCartSession,
                    vpa: null,
                    address_id: Number(s.addressId),
                    direct_wallet_token: null,
                    customer_amount: Number(amount),
                    upi_package_name: null,
                    payment_flow_type: null,
                    sender_id: -1,
                    card_token: null,
                    payment_provider: null,
                    processor_id: null,
                    payment_method: "COD",
                    enable_price_unbundling: true,
                    user_id: Number(acc.user_id)
                };
            } else {
                return {
                    payment_method_type: "UPI",
                    identifier: "buy_now",
                    payment_aggregator: "MPS",
                    is_selling_to_customer: false,
                    cart_session: currentCartSession,
                    vpa: null,
                    address_id: Number(s.addressId),
                    direct_wallet_token: null,
                    customer_amount: Number(amount),
                    upi_package_name: "com.helper.upibridge",
                    payment_flow_type: "intent",
                    sender_id: -1,
                    card_token: null,
                    payment_provider: "JUSPAY_S2S",
                    processor_id: "internal_native",
                    payment_method: "UPI",
                    enable_price_unbundling: true,
                    user_id: Number(acc.user_id)
                };
            }
        };

        let preorderPayload = buildPreorderPayload(isCOD, cartSession, customerAmount);
        let orderRes: any = null;

        try {
            orderRes = await axios.post('https://prod.meeshoapi.com/api/4.0/preorders', preorderPayload, { headers: preorderHeaders });
        } catch (preErr: any) {
            const errMsg = JSON.stringify(preErr.response?.data || preErr.message);
            console.log('Preorder error:', errMsg);
            throw preErr;
        }

        if (orderRes.data?.success === false) {
            const err = orderRes.data?.error || {};
            // If Online UPI QR failed because Meesho disabled QR on this item/seller:
            if (!isCOD && (err?.reason === 'CART_INELIGIBLE' || err?.reason === 'PAYMENT_MODE_NOT_AVAILABLE' || err?.title === 'Review Cart')) {
                await ctx.reply(`⚠️ <i>Online UPI failed or is ineligible on this cart.\nAutomatically falling back to <b>Cash on Delivery (COD)</b> to place your order...</i>`, HTML);
                isCOD = true;
                customerAmount = resTotal || customerAmount;
                preorderPayload = buildPreorderPayload(true, cartSession, customerAmount);
                orderRes = await axios.post('https://prod.meeshoapi.com/api/4.0/preorders', preorderPayload, { headers: preorderHeaders });
            }
        }

        if (orderRes.data?.success === false) {
            const err = orderRes.data?.error || {};
            throw new Error(`Meesho Preorder Error: ${err?.title || ''} - ${err?.message || JSON.stringify(err)}`);
        }

        const orderNum = orderRes.data?.order_num || orderRes.data?.data?.order_num || orderRes.data?.order_id || 'OK';
        
        let intentUrl = '';
        let transactionId = '';

        if (orderRes.data?.transaction_params) {
            let tx: any = orderRes.data.transaction_params;
            if (typeof tx === 'string') {
                try { tx = JSON.parse(tx); } catch { }
            }
            transactionId = tx?.transaction_id || tx?.payload?.transaction_id || '';
            intentUrl = tx?.payload?.payment_details?.data?.upi?.intent_url || '';
        }

        if (!intentUrl && orderRes.data?.qr_transaction_params) {
            let qr: any = orderRes.data.qr_transaction_params;
            if (typeof qr === 'string') {
                try { qr = JSON.parse(qr); } catch { }
            }
            intentUrl = qr?.payload?.intent_url || '';
        }

        let orderStatusMsg = "We have received your order";
        let estDelivery = "";

        // 7. For COD, MUST confirm order via POST /api/3.0/order to finalize it into Meesho OMS!
        if (isCOD) {
            currentStepName = 'POST /api/3.0/order (Confirm Order)';
            try {
                console.log(`Confirming COD order ${orderNum} via POST /api/3.0/order...`);
                const confirmRes = await axios.post('https://prod.meeshoapi.com/api/3.0/order', {
                    pre_order_id: -1,
                    is_selling_to_customer: false,
                    order_num: orderNum,
                    cart_session: cartSession,
                    user_id: Number(acc.user_id)
                }, { headers: preorderHeaders });

                console.log('Order confirmation response:', confirmRes.status, confirmRes.data?.order_status);
                if (confirmRes.data?.order_status_message) {
                    orderStatusMsg = confirmRes.data.order_status_message;
                }
                estDelivery = confirmRes.data?.orders?.[0]?.delivery_details?.estimated_delivery_date || '';
            } catch (confErr: any) {
                console.error('Order confirm call failed:', confErr.response?.data || confErr.message);
                throw new Error(`Order Confirmation Failed: ${JSON.stringify(confErr.response?.data || confErr.message)}`);
            }
        }

        // Record order
        saveOrder({
            orderNum,
            subOrderNum: `${orderNum}_1`,
            juspayOrderId: transactionId || (isCOD ? 'COD_ORDER' : ''),
            amount: customerAmount,
            productId: s.productId,
            productTitle: s.productTitle || '',
            addressId: s.addressId,
            recipientName: s.addrName || '',
            phone: s.addrPhone || acc.phone || '',
            date: new Date().toISOString(),
            telegramUserId: ctx.from?.id,
            status: isCOD ? 'CONFIRMED_COD' : 'PENDING_ONLINE_PAYMENT',
            accountPhone: acc.phone || acc.mobile || '',
            accountUserId: acc.user_id
        });

        if (isCOD) {
            await ctx.reply(
                `🎉 <b>Order Placed & Confirmed on Meesho!</b>\n\n` +
                `🧾 <b>Meesho Order Number:</b> <code>${H(orderNum)}</code>\n` +
                `📦 <b>Product:</b> ${H(s.productTitle || String(s.productId))}\n` +
                `🏷️ <b>Variant:</b> ${H(s.variationName || 'Free Size')}\n` +
                `💰 <b>Amount to Pay on Delivery:</b> ₹${customerAmount}\n` +
                `📍 <b>Delivery Address ID:</b> <code>${s.addressId}</code>\n` +
                (estDelivery ? `🚚 <b>Estimated Delivery:</b> ${H(estDelivery)}\n` : '') +
                `\n✅ <b>Status:</b> ${H(orderStatusMsg)}\n\n` +
                `<i>You can now see this order in the "My Orders" tab of your Meesho app!</i>`,
                HTML
            );
            return ctx.scene.leave();
        }

        // Online UPI QR Flow:
        const finalUpiLink = intentUrl || `upi://pay?pa=MEESHOONLINEPG@ybl&pn=Meesho&am=${customerAmount}&tr=${orderNum}&tn=Payment%20for%20meesho-${orderNum}`;

        await ctx.reply(
            `🎉 <b>Order Created on Meesho!</b>\n\n` +
            `🧾 <b>Meesho Order Number:</b> <code>${H(orderNum)}</code>\n` +
            (transactionId ? `💳 <b>Transaction ID:</b> <code>${H(transactionId)}</code>\n` : '') +
            `💰 <b>Amount to Pay:</b> ₹${customerAmount}\n` +
            `📦 <b>Product:</b> ${H(s.productTitle || String(s.productId))}\n` +
            `🏷️ <b>Variant:</b> ${H(s.variationName || 'Free Size')}\n` +
            `📍 <b>Delivery Address ID:</b> <code>${s.addressId}</code>\n\n` +
            `📲 <b>Scan the QR code below or tap the link to pay with any UPI App:</b>`,
            HTML
        );

        let qrBuffer: Buffer | null = null;
        try {
            qrBuffer = await QRCode.toBuffer(finalUpiLink, {
                type: 'png',
                width: 500,
                margin: 2,
                errorCorrectionLevel: 'M'
            });
        } catch (qrErr) {
            console.error('QRCode generation error:', qrErr);
        }

        const captionText = `📲 <b>Scan & Pay ₹${customerAmount}</b>\nOrder #${orderNum}\n\n🔗 <a href="${finalUpiLink}">Tap here to Open in UPI App (PhonePe / GPay / Paytm)</a>`;

        const qrKeyboard = {
            inline_keyboard: [
                [
                    { text: '❌ Cancel Order / Go Back', callback_data: `cancel_order:${orderNum}` }
                ]
            ]
        };

        if (qrBuffer) {
            await ctx.replyWithPhoto({ source: qrBuffer }, {
                caption: captionText,
                parse_mode: 'HTML',
                reply_markup: qrKeyboard
            });
        } else {
            await ctx.replyWithPhoto(
                `https://api.qrserver.com/v1/create-qr-code/?size=450x450&data=${encodeURIComponent(finalUpiLink)}`,
                {
                    caption: captionText,
                    parse_mode: 'HTML',
                    reply_markup: qrKeyboard
                }
            );
        }

        const sessInfo: ActivePaymentSession = {
            orderNum: String(orderNum),
            transactionId: String(transactionId || ''),
            cartSession,
            userId: Number(acc.user_id),
            headers: preorderHeaders,
            chatId: ctx.chat?.id,
            customerAmount
        };
        activePayments.set(String(orderNum), sessInfo);

        // Live Background Payment Status Checker (matching Meesho App polling)
        if (transactionId) {
            const pollHeaders = { ...headers };
            let pollCount = 0;
            const maxPolls = 36; // 36 * 5s = 3 minutes
            const pollInterval = setInterval(async () => {
                pollCount++;
                if (pollCount > maxPolls || !activePayments.has(String(orderNum))) {
                    clearInterval(pollInterval);
                    activePayments.delete(String(orderNum));
                    return;
                }
                try {
                    const statusRes = await axios.get(`https://prod.meeshoapi.com/api/v3/payments/${transactionId}/status?sync=true`, { headers: pollHeaders });
                    const pStatus = statusRes.data?.status || statusRes.data?.payment_status || statusRes.data?.result?.status;
                    if (pStatus === 'SUCCESS' || pStatus === 'COMPLETED' || pStatus === 'CHARGED') {
                        clearInterval(pollInterval);
                        activePayments.delete(String(orderNum));
                        await ctx.reply(
                            `✅ <b>Payment Successful!</b>\n\n` +
                            `🎉 <b>Order #${orderNum} has been confirmed on Meesho!</b>\n` +
                            `💰 Paid: ₹${customerAmount}\n` +
                            `📦 Check your Meesho app under "My Orders" to track delivery.`,
                            HTML
                        );
                    } else if (pStatus === 'FAILED') {
                        clearInterval(pollInterval);
                        activePayments.delete(String(orderNum));
                        await ctx.reply(`❌ <b>Payment Failed on Meesho</b> for Order #${orderNum}.`, HTML);
                    }
                } catch { }
            }, 5000);
            sessInfo.pollInterval = pollInterval;
        }

    } catch (err: any) {
        const errData = err.response?.data || err.message;
        console.error(`Pipeline error at [${currentStepName}]:`, errData);
        const isCleanMessage = typeof errData === 'string' && !err.response;
        await ctx.reply(
            `❌ <b>Checkout Step Failed at <code>${H(currentStepName)}</code>:</b>\n` +
            (isCleanMessage ? `\n${errData}` : `<pre>${H(typeof errData === 'object' ? JSON.stringify(errData, null, 2).slice(0, 1500) : String(errData))}</pre>`),
            HTML
        );
    }

    return ctx.scene.leave();
}

// ─── Telegraf Stage & Launch ──────────────────────────────────────────────────
const stage = new Scenes.Stage<BotCtx>([orderWizard]);
const bot = new Telegraf<BotCtx>(BOT_TOKEN);
bot.use(session());
bot.use(stage.middleware());

const MAIN_KEYBOARD = Markup.keyboard([
    ['🛒 Order', '➕ Add JSON'],
    ['📦 My Orders', '👤 Accounts']
]).resize();

async function showMyOrders(ctx: any): Promise<void> {
    const telegramUserId = ctx.from?.id;
    const active = await getActiveAccount(telegramUserId);

    let liveMsg = '';
    if (active?.xo && active?.userId) {
        try {
            const h = buildHeaders(active);
            const liveRes = await axios.get('https://prod.meeshoapi.com/api/3.0/orders?offset=0&limit=5', {
                headers: h,
                timeout: 8000
            });
            const meeshoOrders = liveRes.data?.orders || liveRes.data?.result?.orders || [];
            if (meeshoOrders.length > 0) {
                liveMsg += `📦 <b>My Orders — +${H(active.phone || active.userId)}:</b>\n\n`;
                meeshoOrders.forEach((mo: any) => {
                    const oNum = mo.order_num || mo.order_id || 'N/A';
                    const pTitle = mo.items?.[0]?.product_title || mo.product_title || 'Item';
                    const st = mo.order_status_message || mo.order_status || mo.status || 'Active';
                    const amt = mo.total_amount || mo.customer_amount || mo.amount || '';
                    liveMsg += `🛒 <b>${H(pTitle)}</b>\n` +
                               `Order: <code>#${H(oNum)}</code>\n` +
                               (amt ? `💰 Amount: ₹${amt} | ` : '') +
                               `Status: <b>${H(st)}</b>\n\n`;
                });
            }
        } catch (meErr: any) {
            console.log('Live Meesho orders lookup notice:', meErr.response?.data || meErr.message);
        }
    }

    if (liveMsg) {
        await ctx.reply(liveMsg, HTML);
        return;
    }

    // Fallback to locally stored bot checkout history
    try {
        if (!fs.existsSync('orders.json')) {
            await ctx.reply('No orders placed yet.');
            return;
        }
        const orders = JSON.parse(fs.readFileSync('orders.json', 'utf8'));
        if (!orders.length) {
            await ctx.reply('No orders placed yet.');
            return;
        }
        let msg = '📦 <b>Recent Bot Orders History:</b>\n\n';
        orders.slice(0, 5).forEach((o: any) => {
            msg += `🛒 <b>${H(o.productTitle || o.productId)}</b>\n` +
                   `Order: <code>#${H(o.orderNum)}</code>\n` +
                   `💰 Amount: ₹${o.amount} | Status: <b>${H(o.status)}</b>\n\n`;
        });
        await ctx.reply(msg, HTML);
    } catch (e: any) {
        await ctx.reply(`Error reading orders: ${e.message}`);
    }
}

async function sendAccountSelector(ctx: any, page = 1, edit = false): Promise<void> {
    const telegramUserId = ctx.from?.id;
    const accounts = await getAllAccounts(telegramUserId);

    if (!accounts.length) {
        const text = '📂 <b>No Meesho Accounts Saved Yet!</b>\n\n' +
                     'Tap <b>➕ Add JSON</b> below or paste your session JSON / cURL command here:';
        if (edit && ctx.callbackQuery) {
            try { await ctx.editMessageText(text, HTML); } catch { await ctx.reply(text, HTML); }
        } else {
            await ctx.reply(text, HTML);
        }
        return;
    }

    const pageSize = 6;
    const totalPages = Math.ceil(accounts.length / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIdx = (currentPage - 1) * pageSize;
    const pageAccounts = accounts.slice(startIdx, startIdx + pageSize);

    let text = `👤 <b>Select Account</b> · ${accounts.length} total\n` +
               `⭐ <i>last used</i> · 🟢 <i>used</i> · ⚪ <i>unused (FOD Ready)</i>\n`;

    const inlineKeyboard: any[][] = [];

    // 2 columns per row
    for (let i = 0; i < pageAccounts.length; i += 2) {
        const row: any[] = [];
        const acc1 = pageAccounts[i];
        if (acc1) {
            const globalIdx1 = startIdx + i + 1;
            const masked1 = acc1.phone ? acc1.phone.replace(/^\+91|^91|\+/, '').slice(-6) : String(acc1.userId).slice(-6);
            const orderCnt1 = acc1.orderCount || 0;
            const status1 = orderCnt1 === 0 ? '⚪' : '🟢';
            const star1 = acc1.isActive ? ' ⭐' : '';
            row.push({
                text: `${globalIdx1} -> ${masked1} ${status1} ${orderCnt1}x${star1}`,
                callback_data: `sel_acc:${acc1.userId}`
            });
        }

        if (i + 1 < pageAccounts.length) {
            const acc2 = pageAccounts[i + 1];
            if (acc2) {
                const globalIdx2 = startIdx + i + 2;
                const masked2 = acc2.phone ? acc2.phone.replace(/^\+91|^91|\+/, '').slice(-6) : String(acc2.userId).slice(-6);
                const orderCnt2 = acc2.orderCount || 0;
                const status2 = orderCnt2 === 0 ? '⚪' : '🟢';
                const star2 = acc2.isActive ? ' ⭐' : '';
                row.push({
                    text: `${globalIdx2} -> ${masked2} ${status2} ${orderCnt2}x${star2}`,
                    callback_data: `sel_acc:${acc2.userId}`
                });
            }
        }
        if (row.length > 0) {
            inlineKeyboard.push(row);
        }
    }

    // Pagination row
    const navRow: any[] = [];
    if (currentPage > 1) {
        navRow.push({ text: '◀️ Prev', callback_data: `acc_page:${currentPage - 1}` });
    }
    navRow.push({ text: `${currentPage}/${totalPages}`, callback_data: 'noop' });
    if (currentPage < totalPages) {
        navRow.push({ text: 'Next ▶️', callback_data: `acc_page:${currentPage + 1}` });
    }
    inlineKeyboard.push(navRow);

    // Action row
    inlineKeyboard.push([
        { text: '➕ Add JSON', callback_data: 'prompt_add_json' },
        { text: '❌ Cancel', callback_data: 'cancel_acc_select' }
    ]);

    const opts = { ...HTML, reply_markup: { inline_keyboard: inlineKeyboard } };
    if (edit && ctx.callbackQuery) {
        try {
            await ctx.editMessageText(text, opts);
        } catch {
            await ctx.reply(text, opts);
        }
    } else {
        await ctx.reply(text, opts);
    }
}

bot.start(async (ctx) => {
    const mongoStatus = isMongoConnected() ? '🟢 MongoDB Connected' : '🟡 Local Storage Sync';
    await ctx.reply(
        '🤖 <b>KEHAR-STYLE MEESHO ORDER BOT 2.0</b>\n\n' +
        `📦 <b>Database Status:</b> ${mongoStatus}\n\n` +
        '• <b>🛒 Order</b> — Interactive account selector & instant checkout\n' +
        '• <b>➕ Add JSON</b> — Save & activate a new Meesho account session\n' +
        '• <b>📦 My Orders</b> — View orders history & live tracking\n' +
        '• <b>👤 Accounts</b> — View and manage all your accounts',
        {
            ...HTML,
            ...MAIN_KEYBOARD
        }
    );
});

bot.command('order', async (ctx) => {
    await sendAccountSelector(ctx, 1);
});

bot.command('accounts', async (ctx) => {
    await sendAccountSelector(ctx, 1);
});

bot.command('orders', async (ctx) => {
    await showMyOrders(ctx);
});

bot.command('cancel', async (ctx) => {
    await ctx.scene.leave();
    await ctx.reply('Order cancelled. Tap 🛒 Order to restart.', MAIN_KEYBOARD);
});

bot.hears('🛒 Order', async (ctx) => {
    await sendAccountSelector(ctx, 1);
});

bot.hears('➕ Add JSON', async (ctx) => {
    await ctx.reply('📋 <b>Paste Session JSON or cURL:</b>\n\nPaste the exported session JSON or cURL command of the new Meesho account here:', HTML);
});

bot.hears('📦 My Orders', async (ctx) => {
    await showMyOrders(ctx);
});

bot.hears('👤 Accounts', async (ctx) => {
    await sendAccountSelector(ctx, 1);
});

bot.action(/^sel_acc:(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    const telegramUserId = ctx.from?.id;
    await ctx.answerCbQuery('Activating account...');
    const switched = await switchActiveAccount(userId, telegramUserId);

    if (!switched) {
        await ctx.reply('❌ Could not activate this account.');
        return;
    }

    try {
        await ctx.deleteMessage();
    } catch { }

    const phone = switched.phone || switched.mobile || switched.userId;
    const isUnused = (switched.orderCount || 0) === 0;
    const badge = isUnused ? '⚪ 0x (Unused - First Order Discount Ready)' : `🟢 ${switched.orderCount}x Used`;

    await ctx.reply(
        `✅ <b>Selected Account:</b> <code>+${H(phone)}</code>\n` +
        `🏷️ <b>Status:</b> ${badge}\n\n` +
        `📦 <b>Step 2 — Product Link</b>\n\n` +
        `Send a Meesho product URL or numeric Product ID to order:`,
        HTML
    );

    await ctx.scene.enter('ORDER_WIZARD');
});

bot.action(/^acc_page:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await sendAccountSelector(ctx, page, true);
});

bot.action('prompt_add_json', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('📋 <b>Paste Session JSON or cURL:</b>\n\nPaste the exported session JSON or cURL command of the new Meesho account here:', HTML);
});

bot.action('cancel_acc_select', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    try {
        await ctx.deleteMessage();
    } catch {
        await ctx.editMessageText('❌ Selection cancelled.');
    }
});

bot.action('noop', (ctx) => ctx.answerCbQuery());

// Global session listener (allows pasting session JSON anytime without /order)
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (!text.startsWith('/') && (text.startsWith('{') || text.includes('curl') || text.includes('-H \'xo:'))) {
        const parsed = parseSessionInput(text);
        if (parsed?.xo || parsed?.ox) {
            if (parsed.ox) {
                await refreshXo(parsed);
            }
            const telegramUserId = ctx.from?.id;
            const saved = await saveAccount(parsed, telegramUserId);
            const phone = saved.phone || saved.mobile || saved.userId;
            await ctx.reply(
                `🎉 <b>New Account Saved & Activated!</b>\n\n` +
                `📱 <b>Phone:</b> <code>+${H(phone)}</code>\n` +
                `🆔 <b>User ID:</b> <code>${saved.userId}</code>\n` +
                `🏷️ <b>Status:</b> ⚪ 0x (Unused - First Order Discount Ready)\n\n` +
                `Tap <b>🛒 Order</b> below to place an order now!`,
                {
                    ...HTML,
                    ...MAIN_KEYBOARD
                }
            );
            return;
        }
    }
    return next();
});

bot.action(/^cancel_order:(.+)$/, async (ctx) => {
    const orderNum = String((ctx.match as RegExpMatchArray)?.[1] || '');
    if (!orderNum) return;
    await ctx.answerCbQuery('Cancelling order on Meesho...');

    const sess = activePayments.get(orderNum);
    if (sess) {
        if (sess.pollInterval) {
            clearInterval(sess.pollInterval);
        }
        activePayments.delete(orderNum);

        // 1. Report failure to Meesho backend: POST /api/2.0/order/failure
        try {
            console.log(`Sending /api/2.0/order/failure for order ${orderNum}...`);
            await axios.post('https://prod.meeshoapi.com/api/2.0/order/failure', {
                pre_order_id: -1,
                order_num: orderNum,
                cart_session: sess.cartSession,
                user_id: sess.userId
            }, { headers: sess.headers, timeout: 8000 });
            console.log(`✅ Order failure reported to Meesho for ${orderNum}`);
        } catch (failErr: any) {
            console.log('Order failure call notice:', failErr.response?.data || failErr.message);
        }

        // 2. Report payment status update: POST /api/1.0/preorders/payments/status
        try {
            await axios.post('https://prod.meeshoapi.com/api/1.0/preorders/payments/status', {
                pre_order_id: -1,
                is_selling_to_customer: false,
                order_num: orderNum,
                retry_in_sec: 5,
                cart_session: sess.cartSession,
                user_id: sess.userId
            }, { headers: sess.headers, timeout: 8000 });
        } catch { }
    }

    // 3. Update orders.json record
    try {
        if (fs.existsSync('orders.json')) {
            const raw = fs.readFileSync('orders.json', 'utf8');
            let orders = JSON.parse(raw);
            orders = orders.map((o: any) => {
                if (o.orderNum === orderNum) {
                    return { ...o, status: 'CANCELLED_BY_USER' };
                }
                return o;
            });
            fs.writeFileSync('orders.json', JSON.stringify(orders, null, 2));
        }
    } catch { }

    await ctx.reply(
        `❌ <b>Order #${orderNum} Cancelled!</b>\n\n` +
        `The payment request was terminated on Meesho.\n` +
        `Send /order anytime to start a new order.`,
        HTML
    );
});

bot.launch().then(() => console.log('🤖 Meesho Bot is up and running!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));