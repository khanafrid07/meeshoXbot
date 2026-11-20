import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
    title: string;
    price: number;
    category: string;
    imageUrl: string;
    affiliateLink: string;
    createdAt: Date;
}

const ProductSchema = new Schema<IProduct>(
    {
        title: { type: String, required: true },
        price: { type: Number, required: true },
        category: { type: String, required: true },
        imageUrl: { type: String, required: true },
        affiliateLink: { type: String, required: true },
    },
    { timestamps: true }
);

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
export default Product;

