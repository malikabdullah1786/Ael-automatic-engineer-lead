const fs = require("fs");
const content = fs.readFileSync("f:\\z361\\src\\app\\page.tsx", "utf8");
const lines = content.split("\n");
lines.forEach((line, index) => {
  if (line.includes("interruptionReason") || line.includes("teamMembers") || line.includes("deleteMember") || line.includes("Remove Member") || line.includes("Delete Member")) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
