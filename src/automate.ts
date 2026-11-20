import { chromium } from 'playwright';
import fs from 'fs';

async function runMeeshoAutomation() {
    // 1. Launch a persistent or normal Chromium browser instance
    const browser = await chromium.launch({ headless: false }); // Set true once you want it hidden
    const context = await browser.newContext({
        // Spoof a real mobile device user-agent matching your phone environment
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Nothing Phone) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        viewport: { width: 390, height: 844 }, // Mobile screen resolution
    });

    const page = await context.newPage();

    // 2. Load your exported session JSON file
    const possiblePaths = [
        'src/5_6316682945679597997.json',
        '5_6316682945679597997.json',
        'src/session_6743229544.json',
        'session_6743229544.json',
    ];
    const filePath = possiblePaths.find(p => fs.existsSync(p));

    if (!filePath) {
        console.error('❌ Session JSON file not found!');
        await browser.close();
        return;
    }

    const sessionRaw = fs.readFileSync(filePath, 'utf-8');
    const sessionData = JSON.parse(sessionRaw);

    // 3. Inject session tokens/cookies into the browser storage
    // (Note: Depending on how your export structured the tokens, you map `xo` and `ox` into cookies)
    await context.addCookies([
        {
            name: 'xo',
            value: sessionData.xo,
            domain: '.meesho.com',
            path: '/',
        },
        {
            name: 'ox',
            value: sessionData.ox,
            domain: '.meesho.com',
            path: '/',
        }
    ]);

    console.log('🍪 Session tokens injected into browser!');

    // 4. Navigate to Meesho Site
    await page.goto('https://www.meesho.com');

    // 5. Verify if the account is logged in automatically
    // The browser will now render the site as your authenticated user session, 
    // bypassing account creation blocks entirely!

    console.log('✨ Browser automation ready. You can now script product selection and checkout steps.');
}

runMeeshoAutomation();