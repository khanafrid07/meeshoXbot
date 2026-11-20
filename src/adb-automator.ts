import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

// Helper function to run ADB commands easily
async function runAdb(command: string) {
    try {
        const { stdout, stderr } = await execAsync(`adb ${command}`);
        if (stderr) console.error(`ADB Warning: ${stderr}`);
        return stdout.trim();
    } catch (error: any) {
        console.error(`❌ ADB Command Failed (${command}):`, error.message);
        throw error;
    }
}

// Helper to pause for human-like timing between actions
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runMeeshoAdbAutomation() {
    console.log('🚀 Starting ADB Emulator Automation for Meesho...');

    // 1. Verify emulator connection
    const devicesOutput = await runAdb('devices');
    console.log(`📱 Connected Devices:\n${devicesOutput}`);

    // Parse lines excluding header
    const deviceLines = devicesOutput
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.toLowerCase().startsWith('list of devices'));

    const hasConnectedDevice = deviceLines.some(l => l.endsWith('device'));

    if (!hasConnectedDevice) {
        console.error('❌ No Android emulator detected via ADB! Make sure your emulator is running.');
        return;
    }

    // 2. Bring the Meesho app to the foreground (Fixed using monkey launcher)
    console.log('📦 Launching Meesho app...');
    await runAdb('shell monkey -p com.meesho.supply -c android.intent.category.LAUNCHER 1');
    await sleep(4000); // Wait for app to load

    // 3. Example Taps & Interactions (Adjust coordinates based on your emulator screen resolution)
    // Tip: You can find screen coordinates by enabling "Pointer Location" in your emulator's Developer Options.

    console.log('🔍 Clicking search bar / product...');
    // Example tap coordinate for top search bar (X: 540, Y: 150)
    await runAdb('shell input tap 540 150');
    await sleep(1000);

    console.log('⌨️ Typing product search query...');
    // Type text directly into the active field
    await runAdb('shell input text "Kurti"');
    await sleep(1000);

    // Press Enter key to search (Keyevent 66 is Enter)
    await runAdb('shell input keyevent 66');
    await sleep(2500);

    console.log('🖱️ Clicking the first product result...');
    // Tap on the first product card position on screen (X: 200, Y: 500)
    await runAdb('shell input tap 200 500');
    await sleep(2000);

    console.log('🛒 Clicking "Buy Now" or "Add to Cart"...');
    // Tap "Buy Now" button position (X: 540, Y: 2150)
    await runAdb('shell input tap 540 2150');
    await sleep(2000);

    console.log('✅ Basic ADB flow executed successfully!');
}

runMeeshoAdbAutomation();