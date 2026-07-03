import * as dotenv from "dotenv";
import * as path from "path";

// Load local environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testRemediation() {
  console.log("Loading AEL graph dynamically...");
  const { aelGraph } = await import("./src/lib/agent");
  console.log("Compiling AEL graph...");
  const graph = aelGraph.compile();

  const config = { configurable: { thread_id: "test-remediation-thread-" + Date.now() } };

  console.log("\n--- Step 1: Request Daily Standup ---");
  try {
    const result = await graph.invoke({
      messages: [{ role: "user", content: "give me the daily standup status update" }]
    }, config);

    console.log("Step 1 Complete.");
    console.log("Last Message:", result.messages[result.messages.length - 1]?.content);
    console.log("Interruption Reason:", result.interruptionReason);
    console.log("Queue size:", result.overdueTasksQueue?.length);
    console.log("Queue contents:", result.overdueTasksQueue?.map((t: any) => t.task_title));

    if (result.interruptionReason === "standup_remediation_approval") {
      console.log("\n--- Step 2: Approve Proactive Remediation ('yes') ---");
      const result2 = await graph.invoke({
        messages: [{ role: "user", content: "yes" }]
      }, config);

      console.log("Step 2 Complete.");
      console.log("Last Message:", result2.messages[result2.messages.length - 1]?.content);
      console.log("Interruption Reason:", result2.interruptionReason);
      console.log("Current Task Dev:", result2.devName, `(${result2.devEmail})`);
      console.log("Pending Action:", result2.pendingAction ? "Yes" : "No");
      
      if (result2.interruptionReason === "human_approval_required") {
        console.log("\n--- Step 3: Approve Calendar/Ticket Creation for first task ('yes') ---");
        const result3 = await graph.invoke({
          messages: [{ role: "user", content: "yes" }]
        }, config);

        console.log("Step 3 Complete.");
        console.log("Last Message:", result3.messages[result3.messages.length - 1]?.content);
        console.log("Interruption Reason:", result3.interruptionReason);
        console.log("Remaining Queue size:", result3.overdueTasksQueue?.length);
        console.log("Current State Dev (should be next task's dev):", result3.devName, `(${result3.devEmail})`);
      }
    }
  } catch (err) {
    console.error("Test execution failed:", err);
  }
}

testRemediation();
