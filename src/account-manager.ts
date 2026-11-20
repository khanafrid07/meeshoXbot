import fs from 'fs';
import mongoose from 'mongoose';
import { AccountModel } from './models/Account.js';

const FALLBACK_FILE = 'src/accounts_store.json';

export interface StoredAccount {
    _id?: string;
    telegramUserId?: number | undefined;
    phone: string;
    mobile?: string | undefined;
    userId: number;
    user_id: number;
    name?: string | undefined;
    xo: string;
    ox?: string | undefined;
    authorization?: string | undefined;
    instanceId?: string | undefined;
    instance_id?: string | undefined;
    appSessionId?: string | undefined;
    app_session_id?: string | undefined;
    gaid?: string | undefined;
    uToken?: string | undefined;
    u_token?: string | undefined;
    orderCount?: number | undefined;
    isActive: boolean;
    lastUsedAt?: string | Date | undefined;
}

export function isMongoConnected(): boolean {
    return mongoose.connection.readyState === 1;
}

export function normalizeAccount(d: any): StoredAccount {
    const uid = Number(d.user_id || d.userId);
    const rawPh = String(d.phone || d.mobile || uid).replace(/^\++/, '+');
    const cleanMob = rawPh.replace(/^\+91|^91|\+/, '');
    const instId = d.instance_id || d.instanceId || '';
    const sessId = d.app_session_id || d.appSessionId || '';
    const uTok = d.u_token || d.uToken || '';

    return {
        ...d,
        _id: d._id ? String(d._id) : undefined,
        phone: rawPh,
        mobile: cleanMob,
        userId: uid,
        user_id: uid,
        instanceId: instId,
        instance_id: instId,
        appSessionId: sessId,
        app_session_id: sessId,
        uToken: uTok,
        u_token: uTok,
        orderCount: Number(d.orderCount || d.order_count || 0),
        name: d.name || rawPh,
        isActive: !!d.isActive,
        lastUsedAt: d.lastUsedAt || new Date()
    };
}

// Local File Helpers (Fallback when Mongo is offline or connecting)
function loadLocalAccounts(): StoredAccount[] {
    try {
        if (fs.existsSync(FALLBACK_FILE)) {
            const raw = fs.readFileSync(FALLBACK_FILE, 'utf8');
            const arr = JSON.parse(raw) || [];
            return arr.map(normalizeAccount);
        }
    } catch { }
    // If active session exists, import it as first account
    try {
        if (fs.existsSync('src/session_active.json')) {
            const act = JSON.parse(fs.readFileSync('src/session_active.json', 'utf8'));
            if (act?.xo && (act?.user_id || act?.userId)) {
                const acc = normalizeAccount({
                    phone: act.phone || act.mobile || String(act.user_id || act.userId),
                    mobile: act.mobile || act.phone || '',
                    userId: Number(act.user_id || act.userId),
                    user_id: Number(act.user_id || act.userId),
                    name: `+${String(act.phone || act.mobile || act.user_id || act.userId).replace(/^\++/, '')}`,
                    xo: act.xo,
                    ox: act.ox || '',
                    authorization: act.authorization || '32c4d8137cn9eb493a1921f203173080',
                    instanceId: act.instance_id || act.instanceId || '',
                    appSessionId: act.app_session_id || act.appSessionId || '',
                    gaid: act.gaid || '',
                    uToken: act.u_token || act.uToken || '',
                    isActive: true,
                    lastUsedAt: new Date()
                });
                saveLocalAccounts([acc]);
                return [acc];
            }
        }
    } catch { }
    return [];
}

function saveLocalAccounts(accounts: StoredAccount[]) {
    try {
        fs.writeFileSync(FALLBACK_FILE, JSON.stringify(accounts, null, 2));
    } catch (e: any) {
        console.error('Failed to write local accounts:', e.message);
    }
}

/**
 * Get all accounts for a specific Telegram user (or all if not filtered).
 */
export async function getAllAccounts(telegramUserId?: number): Promise<StoredAccount[]> {
    if (isMongoConnected()) {
        try {
            const query: any = {};
            if (telegramUserId) query.telegramUserId = telegramUserId;
            const docs = await AccountModel.find(query).sort({ lastUsedAt: -1 }).lean();
            if (docs.length > 0) {
                return docs.map(normalizeAccount);
            }
        } catch (err: any) {
            console.error('Mongo getAllAccounts error, falling back to local file:', err.message);
        }
    }

    const locals = loadLocalAccounts();
    if (telegramUserId) {
        return locals.filter(a => !a.telegramUserId || a.telegramUserId === telegramUserId);
    }
    return locals;
}

/**
 * Get the currently active account.
 */
export async function getActiveAccount(telegramUserId?: number): Promise<StoredAccount | null> {
    const list = await getAllAccounts(telegramUserId);
    if (!list.length) return null;
    return list.find(a => a.isActive) || list[0] || null;
}

/**
 * Save or update an account from parsed session info.
 */
export async function saveAccount(accData: any, telegramUserId?: number): Promise<StoredAccount> {
    const userId = Number(accData.user_id || accData.userId);
    const rawPhone = String(accData.phone || accData.mobile || userId).replace(/^\++/, '+');
    const cleanMobile = rawPhone.replace(/^\+91|^91|\+/, '');

    const accountObj: StoredAccount = normalizeAccount({
        telegramUserId,
        phone: rawPhone,
        mobile: cleanMobile,
        userId,
        user_id: userId,
        name: accData.name || rawPhone,
        xo: accData.xo,
        ox: accData.ox || '',
        authorization: accData.authorization || '32c4d8137cn9eb493a1921f203173080',
        instanceId: accData.instance_id || accData.instanceId || '',
        instance_id: accData.instance_id || accData.instanceId || '',
        appSessionId: accData.app_session_id || accData.appSessionId || '',
        app_session_id: accData.app_session_id || accData.appSessionId || '',
        gaid: accData.gaid || '',
        uToken: accData.u_token || accData.uToken || '',
        u_token: accData.u_token || accData.uToken || '',
        isActive: true,
        lastUsedAt: new Date()
    });

    if (isMongoConnected()) {
        try {
            // Deactivate all others for this user first
            if (telegramUserId) {
                await AccountModel.updateMany({ telegramUserId }, { isActive: false });
            }
            const saved = await AccountModel.findOneAndUpdate(
                { userId, ...(telegramUserId ? { telegramUserId } : {}) },
                { $set: accountObj },
                { upsert: true, new: true }
            ).lean();
            // Also keep local sync
            const locals = loadLocalAccounts().filter(a => a.userId !== userId);
            locals.forEach(a => a.isActive = false);
            locals.unshift(accountObj);
            saveLocalAccounts(locals);
            // Save active to session_active.json for backward compatibility
            try {
                fs.writeFileSync('src/session_active.json', JSON.stringify(accountObj, null, 2));
            } catch { }
            return normalizeAccount(saved);
        } catch (err: any) {
            console.error('Mongo saveAccount error:', err.message);
        }
    }

    // Local file fallback
    const locals = loadLocalAccounts().filter(a => a.userId !== userId);
    locals.forEach(a => a.isActive = false);
    locals.unshift(accountObj);
    saveLocalAccounts(locals);
    try {
        fs.writeFileSync('src/session_active.json', JSON.stringify(accountObj, null, 2));
    } catch { }
    return accountObj;
}

/**
 * Switch active account by userId.
 */
export async function switchActiveAccount(userId: number, telegramUserId?: number): Promise<StoredAccount | null> {
    if (isMongoConnected()) {
        try {
            if (telegramUserId) {
                await AccountModel.updateMany({ telegramUserId }, { isActive: false });
            } else {
                await AccountModel.updateMany({}, { isActive: false });
            }
            const updated = await AccountModel.findOneAndUpdate(
                { userId },
                { isActive: true, lastUsedAt: new Date() },
                { new: true }
            ).lean();
            if (updated) {
                const norm = normalizeAccount(updated);
                try {
                    fs.writeFileSync('src/session_active.json', JSON.stringify(norm, null, 2));
                } catch { }
                return norm;
            }
        } catch (err: any) {
            console.error('Mongo switchActiveAccount error:', err.message);
        }
    }

    const locals = loadLocalAccounts();
    let found: StoredAccount | null = null;
    for (const a of locals) {
        if (a.userId === userId) {
            a.isActive = true;
            a.lastUsedAt = new Date();
            found = a;
        } else {
            a.isActive = false;
        }
    }
    saveLocalAccounts(locals);
    if (found) {
        const norm = normalizeAccount(found);
        try {
            fs.writeFileSync('src/session_active.json', JSON.stringify(norm, null, 2));
        } catch { }
        return norm;
    }
    return null;
}

/**
 * Delete an account by userId.
 */
export async function deleteAccount(userId: number, telegramUserId?: number): Promise<boolean> {
    if (isMongoConnected()) {
        try {
            await AccountModel.deleteOne({ userId, ...(telegramUserId ? { telegramUserId } : {}) });
        } catch (err: any) {
            console.error('Mongo deleteAccount error:', err.message);
        }
    }
    const locals = loadLocalAccounts().filter(a => a.userId !== userId);
    if (locals.length > 0 && !locals.some(a => a.isActive)) {
        const first = locals[0];
        if (first) first.isActive = true;
    }
    saveLocalAccounts(locals);
    return true;
}

/**
 * Increment the successful order count for an account.
 */
export async function incrementAccountOrderCount(userId: number): Promise<void> {
    if (isMongoConnected()) {
        try {
            await AccountModel.updateOne({ userId }, { $inc: { orderCount: 1 } });
        } catch (err: any) {
            console.error('Mongo incrementAccountOrderCount error:', err.message);
        }
    }
    const locals = loadLocalAccounts();
    for (const a of locals) {
        if (a.userId === userId) {
            a.orderCount = (a.orderCount || 0) + 1;
        }
    }
    saveLocalAccounts(locals);
    try {
        if (fs.existsSync('src/session_active.json')) {
            const raw = fs.readFileSync('src/session_active.json', 'utf8');
            const data = JSON.parse(raw);
            if (Number(data.user_id || data.userId) === userId) {
                data.orderCount = (data.orderCount || 0) + 1;
                fs.writeFileSync('src/session_active.json', JSON.stringify(data, null, 2));
            }
        }
    } catch { }
}
