const fs = require('fs');
const path = require('path');

const filePath = 'f:\\z361\\src\\app\\page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = 'messages.map((m, idx) => (';
const lines = content.split(/\r?\n/);
let found = false;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(targetStr) && !lines[i].includes(') : (')) {
    console.log(`Found malformed line at ${i + 1}: ${lines[i]}`);
    lines[i] = '                        ) : (\n                          messages.map((m, idx) => (';
    found = true;
    break;
  }
}

if (found) {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.log('Successfully fixed syntax error in page.tsx!');
} else {
  console.log('Could not find malformed line in page.tsx.');
}
