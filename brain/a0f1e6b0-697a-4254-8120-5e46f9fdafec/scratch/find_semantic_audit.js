const fs = require("fs");
const content = fs.readFileSync("f:\\z361\\src\\lib\\agent.ts", "utf8");
const lines = content.split("\n");
lines.forEach((line, index) => {
  if (line.includes("semanticAuditNode")) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
