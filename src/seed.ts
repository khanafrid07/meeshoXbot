import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/afridXmeesho';

const sampleProducts = [
    {
        title: 'Men Casual Slim Fit Shirt',
        price: 499,
        category: 'Clothing',
        imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500',
        affiliateLink: 'https://meesho.com/example-shirt',
    },
    {
        title: 'Women Floral Print Kurti',
        price: 399,
        category: 'Clothing',
        imageUrl: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500',
        affiliateLink: 'https://meesho.com/example-kurti',
    },
    {
        title: 'Wireless Bluetooth Earbuds',
        price: 699,
        category: 'Electronics',
        imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500',
        affiliateLink: 'https://meesho.com/example-earbuds',
    },
    {
        title: 'Classic Leather Wallet',
        price: 249,
        category: 'Accessories',
        imageUrl: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=500',
        affiliateLink: 'https://meesho.com/example-wallet',
    },
    {
        title: 'Smart Fitness Tracker Watch',
        price: 899,
        category: 'Electronics',
        imageUrl: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=500',
        affiliateLink: 'https://meesho.com/example-watch',
    },
];

async function seedDatabase() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB.');

        // Clear existing products
        await Product.deleteMany({});
        console.log('Cleared existing products.');

        // Insert new sample products
        await Product.insertMany(sampleProducts);
        console.log(`Successfully seeded ${sampleProducts.length} products!`);

        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding database:', error);
        process.exit(1);
    }
}

seedDatabase();