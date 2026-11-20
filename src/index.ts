import { Telegraf } from 'telegraf';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
if (!process.env.BOT_TOKEN) {
    dotenv.config({ path: '../.env' });
}

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/afridXmeesho';

if (!BOT_TOKEN) {
    console.error('Error: BOT_TOKEN is missing in your .env file!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Connect to MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Handle /start command
bot.start((ctx) => {
    ctx.reply(
        `Welcome to the Shopping Bot! 🛍️\nSearch for trending products, clothing, and accessories right here.`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔍 Search Products', callback_data: 'search_products' }],
                    [{ text: '📂 Browse Categories', callback_data: 'browse_categories' }],
                    [{ text: '💼 My Saved Items', callback_data: 'saved_items' }]
                ]
            }
        }
    );
});

// Handle button clicks
bot.action('search_products', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Please send me the name of the product you are looking for:');
});

// Launch bot
bot.launch()
    .then(() => console.log('Bot is running...'))
    .catch(err => console.error('Failed to launch bot:', err));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
