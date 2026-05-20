// Run once: node gen-icons.js
// Generates icon-192.png and icon-512.png for the PWA manifest.
const { createCanvas } = require('canvas');
const fs = require('fs');

function makeIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');

  // Background
  ctx.fillStyle = '#08041c';
  ctx.fillRect(0, 0, size, size);

  // Gold circle
  const r = size * 0.42;
  const grd = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, r);
  grd.addColorStop(0, '#f7971e');
  grd.addColorStop(1, '#ffd200');
  ctx.beginPath();
  ctx.arc(size/2, size/2, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // Text "F"
  ctx.fillStyle = '#08041c';
  ctx.font = `bold ${size * 0.42}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('F', size / 2, size / 2 + size * 0.03);

  return c.toBuffer('image/png');
}

fs.writeFileSync('icon-192.png', makeIcon(192));
fs.writeFileSync('icon-512.png', makeIcon(512));
console.log('Icons generated: icon-192.png, icon-512.png');
