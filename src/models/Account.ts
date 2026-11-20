import mongoose, { Schema, Document } from 'mongoose';

export interface IAccount extends Document {
    telegramUserId?: number;
    phone: string;
    mobile?: string;
    userId: number;
    name?: string;
    xo: string;
    ox?: string;
    authorization?: string;
    instanceId?: string;
    appSessionId?: string;
    gaid?: string;
    uToken?: string;
    orderCount?: number;
    isActive: boolean;
    lastUsedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AccountSchema = new Schema<IAccount>(
    {
        telegramUserId: { type: Number, index: true },
        phone: { type: String, required: true, index: true },
        mobile: { type: String },
        userId: { type: Number, required: true },
        name: { type: String, default: '' },
        xo: { type: String, required: true },
        ox: { type: String, default: '' },
        authorization: { type: String, default: '32c4d8137cn9eb493a1921f203173080' },
        instanceId: { type: String, default: '' },
        appSessionId: { type: String, default: '' },
        gaid: { type: String, default: '' },
        uToken: { type: String, default: '' },
        orderCount: { type: Number, default: 0 },
        isActive: { type: Boolean, default: false },
        lastUsedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

AccountSchema.index({ telegramUserId: 1, userId: 1 }, { unique: true });

export const AccountModel = mongoose.model<IAccount>('Account', AccountSchema);

