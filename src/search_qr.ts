import * as fs from 'fs';

const html = fs.readFileSync('juspay_page.html', 'utf8');
const lines = html.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('QR') || l.includes('qr')) {
    console.log(`Line ${idx}: ${l.trim()}`);
  }
});

