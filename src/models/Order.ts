import { Schema, model, Document } from 'mongoose';

export interface IOrder extends Document {
    telegramId: number;
    customerName: string;
    phone: string;
    address: string;
    items: Array<{
        productId: string;
        title: string;
        price: number;
        size?: string;
        quantity: number;
    }>;
    totalAmount: number;
    status: 'pending_checkout' | 'pending_fulfillment' | 'shipped' | 'cancelled';
    createdAt: Date;
}

const OrderSchema = new Schema<IOrder>({
    telegramId: { type: Number, required: true },
    customerName: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    items: [{
        productId: String,
        title: String,
        price: Number,
        size: String,
        quantity: Number
    }],
    totalAmount: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending_checkout', 'pending_fulfillment', 'shipped', 'cancelled'],
        default: 'pending_checkout'
    },
    createdAt: { type: Date, default: Date.now }
});

export const Order = model<IOrder>('Order', OrderSchema);