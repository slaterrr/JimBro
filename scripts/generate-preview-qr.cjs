// Uses the QR encoder already installed with Expo CLI; no remote QR service.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const appRequire = createRequire(path.resolve(__dirname, '../apps/expo/package.json'));
const { toQR } = appRequire('toqr');
const url = 'https://expo.dev/accounts/slaterr/projects/jimbro/branches/preview';
const qr = toQR(url);
const side = Math.sqrt(qr.length);
const modules = [];
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    if (qr[y * side + x]) modules.push(`M${x + 4},${y + 4}h1v1h-1z`);
  }
}
fs.mkdirSync(path.resolve(__dirname, '../docs/testing'), { recursive: true });
fs.writeFileSync(path.resolve(__dirname, '../docs/testing/preview-qr.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side + 8} ${side + 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${modules.join('')}" fill="black"/></svg>\n`);
console.log(url);
