import { chromium } from 'playwright';
import * as fs from 'fs';

async function runStealthAutomation() {
    // 1. Launch browser with arguments that mask automation flags
    const browser = await chromium.launch({
        headless: false, // MUST be false. Headless mode triggers instant Akamai bot blocks.
        args: [
            '--disable-blink-features=AutomationControlled', // Hides Playwright flags
            '--disable-infobars',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Nothing Phone) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2.75,
        isMobile: true,
        hasTouch: true,
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
    });

    const page = await context.newPage();

    // 2. Override navigator.webdriver via CDP (Chrome DevTools Protocol) to stay completely hidden from Akamai
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
        // Spoof plugins and languages to match a real mobile phone
        // @ts-ignore
        navigator.languages = ['en-US', 'en'];
    });

    // 3. Read your session JSON file
    const sessionFilePath = fs.existsSync('session_6743229544.json')
        ? 'session_6743229544.json'
        : '5_6316682945679597997.json';

    if (fs.existsSync(sessionFilePath)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'));

        // Navigate first to establish the cookie domain context
        await page.goto('https://m.meesho.com', { waitUntil: 'domcontentloaded' });

        const cookies = [];
        if (sessionData.xo) cookies.push({ name: 'xo', value: String(sessionData.xo), domain: '.meesho.com', path: '/' });
        if (sessionData.ox) cookies.push({ name: 'ox', value: String(sessionData.ox), domain: '.meesho.com', path: '/' });

        if (cookies.length > 0) {
            await context.addCookies(cookies);
            console.log(`🍪 Injected ${cookies.length} session tokens successfully.`);
        }
    }

    console.log('🚀 Navigating to m.meesho.com with stealth mode active...');

    // Use m.meesho.com (mobile web version) instead of www.meesho.com to match mobile fingerprints
    await page.goto('https://www.meesho.com', { waitUntil: 'networkidle' });

    console.log('👀 Browser open. Check if Akamai access denial is bypassed...');
    await page.waitForTimeout(20000);

    await browser.close();
}

runStealthAutomation();