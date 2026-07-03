require("dotenv").config({ path: "f:/z361/.env.local" });
const { aelGraph } = require("f:/z361/src/lib/agent");
const { MemorySaver } = require("@langchain/langgraph");

async function run() {
  const checkpointer = new MemorySaver();
  const graph = aelGraph.compile({ checkpointer });

  const config = {
    configurable: {
      thread_id: "test-thread",
      modelName: "models/gemini-3.1-flash-lite",
    },
  };

  // 1. Setup state to simulate being interrupted for meeting time
  console.log("Setting initial state...");
  await graph.updateState(config, {
    projectId: "d2c3df44-4f4b-4a5f-9721-36b0c27943d0", // placeholder
    devName: "M. Husnain",
    devEmail: "malikabdullahfast@gmail.com",
    errorTrace: "Overdue Critical Task: Resolve DB Connection Refused",
    interruptionReason: "meeting_time_required",
    messages: [
      { role: "assistant", content: "📅 Meeting Time Required: Please specify..." },
      { role: "user", content: "tommorrow 3 pm" }
    ]
  });

  console.log("\n--- Invoking graph ---");
  const result = await graph.invoke({}, config);
  console.log("\n--- Graph run completed ---");
  console.log("Final interruptionReason:", result.interruptionReason);
  console.log("Final meetingTime:", result.meetingTime);
  console.log("Final messages count:", result.messages.length);
  console.log("Last message:", result.messages[result.messages.length - 1]);
}

run().catch(console.error);
