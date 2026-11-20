// models/UserSession.ts
import { Schema, model, Document } from 'mongoose';

export interface ISessionData extends Document {
    telegramId: number;
    mobile: string;
    sessionJson: any;
    createdAt: Date;
}

const UserSessionSchema = new Schema<ISessionData>({
    telegramId: { type: Number, required: true, unique: true },
    mobile: { type: String, required: true },
    sessionJson: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
});

export const UserSession = model<ISessionData>('UserSession', UserSessionSchema);