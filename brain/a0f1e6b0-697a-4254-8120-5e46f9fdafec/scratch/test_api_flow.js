const crypto = require("crypto");

async function run() {
  const threadId = "test-thread-" + crypto.randomUUID();
  console.log(`Using Thread ID: ${threadId}`);

  // 1. Send first message
  console.log("\n--- Sending first request: 'Give me a status update on the team' ---");
  let res = await fetch("http://localhost:3000/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Give me a status update on the team",
      threadId,
      modelName: "models/gemini-3.1-flash-lite"
    })
  });
  let data = await res.json();
  console.log("Reply:", data.reply);
  console.log("Interruption:", data.interruptionReason);

  // 2. Check Jira status directly
  console.log("\n--- Checking Jira Status for Muhammad Abdullah ---");
  res = await fetch("http://localhost:3000/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Check Muhammad Abdullah's tasks in Jira",
      threadId,
      modelName: "models/gemini-3.1-flash-lite"
    })
  });
  data = await res.json();
  console.log("Reply:", data.reply);
}

run().catch(console.error);
