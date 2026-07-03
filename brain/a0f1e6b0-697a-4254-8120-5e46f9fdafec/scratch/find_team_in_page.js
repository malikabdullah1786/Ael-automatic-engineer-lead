const fs = require("fs");
const content = fs.readFileSync("f:\\z361\\src\\app\\page.tsx", "utf8");
const lines = content.split("\n");
lines.forEach((line, index) => {
  if (line.includes("/api/team") || line.includes("activeTab === 'team'") || line.includes("tab === 'team'") || line.includes("role") && line.includes("email")) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
