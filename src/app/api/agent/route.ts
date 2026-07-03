import { NextRequest, NextResponse } from "next/server";
import { MemorySaver } from "@langchain/langgraph";
import { aelGraph } from "@/lib/agent";

// Initialize a persistent in-memory checkpointer for local development
// This retains conversation state and checkpoints across server requests
const checkpointer = new MemorySaver();
const graph = aelGraph.compile({ checkpointer });

export async function POST(req: NextRequest) {
  try {
    const { message, threadId, approvalDecision, emailInput, modelName } = await req.json();

    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId parameter." }, { status: 400 });
    }

    const config = {
      configurable: {
        thread_id: threadId,
        modelName: modelName || "models/gemini-3.1-flash-lite"
      }
    };
    let responseState;

    // Check if graph is currently interrupted
    const currentState = await graph.getState(config);
    const hasInterrupt = currentState.values && currentState.values.interruptionReason;
    const isFinished = !currentState.next || currentState.next.length === 0;

    // Case 1: Resuming from a Human-in-the-Loop Action Approval (Edge Case 5)
    if (approvalDecision) {
      const isApproved = approvalDecision === "approve";
      
      // Update graph state with user's decision
      await graph.updateState(config, {
        actionApproved: isApproved,
        interruptionReason: null,
        messages: [{ role: "user", content: isApproved ? "yes" : "no" }]
      });

      // Resume execution
      responseState = isFinished
        ? await graph.invoke({}, config)
        : await graph.invoke(null, config);
    } 
    // Case 2: Resuming from an Unmapped Developer Identity Email Prompt (Edge Case 3)
    else if (emailInput) {
      const email = emailInput.trim();
      
      // Update state with the newly provided email address
      await graph.updateState(config, {
        devEmail: email,
        interruptionReason: null,
        messages: [{ role: "user", content: email }]
      });

      // Resume execution
      responseState = isFinished
        ? await graph.invoke({}, config)
        : await graph.invoke(null, config);
    }
    // Case 3: Resuming from an active interrupt state via general text message (e.g. workload_overload)
    else if (hasInterrupt && message) {
      await graph.updateState(config, {
        interruptionReason: null,
        messages: [{ role: "user", content: message }]
      });
      
      responseState = isFinished
        ? await graph.invoke({}, config)
        : await graph.invoke(null, config);
    }
    // Case 4: Standard User Chat Message
    else {
      if (!message) {
        return NextResponse.json({ error: "Missing message parameter." }, { status: 400 });
      }

      responseState = await graph.invoke({
        messages: [{ role: "user", content: message }]
      }, config);
    }

    // Extract the final messages list and control properties
    const messages = responseState.messages || [];
    const lastMessage = messages[messages.length - 1];
    
    return NextResponse.json({
      success: true,
      reply: lastMessage?.content || "No reply generated.",
      messages: messages.map((m: any) => ({
        role: m.role || (m.constructor.name === "HumanMessage" ? "user" : "assistant"),
        content: m.content
      })),
      interruptionReason: responseState.interruptionReason,
      pendingAction: responseState.pendingAction
    });

  } catch (error: any) {
    console.error("Agent API endpoint failure:", error);
    const isRateLimit = error.status === 429 || error.message?.includes("429") || error.message?.includes("Too Many Requests");
    return NextResponse.json(
      { error: isRateLimit ? "⚠️ Google Gemini API Rate Limit Exceeded (429: Too Many Requests). Please wait a few seconds and try again." : error.message },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}
