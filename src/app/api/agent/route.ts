import { NextRequest, NextResponse } from "next/server";
import { MemorySaver } from "@langchain/langgraph";
import { aelGraph } from "@/lib/agent";
import fs from "fs";
import path from "path";

// Helper functions to handle Uint8Array serialization/deserialization to base64 for JSON persistence
function serializeStorage(storage: any) {
  const result: any = {};
  for (const threadId in storage) {
    result[threadId] = {};
    for (const ns in storage[threadId]) {
      result[threadId][ns] = {};
      for (const cpId in storage[threadId][ns]) {
        const entry = storage[threadId][ns][cpId];
        result[threadId][ns][cpId] = [
          entry[0] instanceof Uint8Array ? Buffer.from(entry[0]).toString("base64") : entry[0],
          entry[1] instanceof Uint8Array ? Buffer.from(entry[1]).toString("base64") : entry[1],
          entry[2]
        ];
      }
    }
  }
  return result;
}

function deserializeStorage(storage: any) {
  const result: any = Object.create(null);
  if (!storage) return result;
  for (const threadId in storage) {
    result[threadId] = Object.create(null);
    for (const ns in storage[threadId]) {
      result[threadId][ns] = Object.create(null);
      for (const cpId in storage[threadId][ns]) {
        const entry = storage[threadId][ns][cpId];
        let cpBuffer: Uint8Array;
        if (typeof entry[0] === "string") {
          cpBuffer = new Uint8Array(Buffer.from(entry[0], "base64"));
        } else if (entry[0] && typeof entry[0] === "object") {
          const bytes = Object.keys(entry[0])
            .sort((a, b) => Number(a) - Number(b))
            .map(k => (entry[0] as any)[k]);
          cpBuffer = new Uint8Array(bytes);
        } else {
          cpBuffer = entry[0];
        }

        let metaBuffer: Uint8Array;
        if (typeof entry[1] === "string") {
          metaBuffer = new Uint8Array(Buffer.from(entry[1], "base64"));
        } else if (entry[1] && typeof entry[1] === "object") {
          const bytes = Object.keys(entry[1])
            .sort((a, b) => Number(a) - Number(b))
            .map(k => (entry[1] as any)[k]);
          metaBuffer = new Uint8Array(bytes);
        } else {
          metaBuffer = entry[1];
        }

        result[threadId][ns][cpId] = [
          cpBuffer,
          metaBuffer,
          entry[2]
        ];
      }
    }
  }
  return result;
}

function serializeWrites(writes: any) {
  const result: any = {};
  for (const outerKey in writes) {
    result[outerKey] = {};
    for (const innerKey in writes[outerKey]) {
      const entry = writes[outerKey][innerKey];
      result[outerKey][innerKey] = [
        entry[0],
        entry[1],
        entry[2] instanceof Uint8Array ? Buffer.from(entry[2]).toString("base64") : entry[2]
      ];
    }
  }
  return result;
}

function deserializeWrites(writes: any) {
  const result: any = Object.create(null);
  if (!writes) return result;
  for (const outerKey in writes) {
    result[outerKey] = Object.create(null);
    for (const innerKey in writes[outerKey]) {
      const entry = writes[outerKey][innerKey];
      let valBuffer: Uint8Array;
      if (typeof entry[2] === "string") {
        valBuffer = new Uint8Array(Buffer.from(entry[2], "base64"));
      } else if (entry[2] && typeof entry[2] === "object") {
        const bytes = Object.keys(entry[2])
          .sort((a, b) => Number(a) - Number(b))
          .map(k => (entry[2] as any)[k]);
        valBuffer = new Uint8Array(bytes);
      } else {
        valBuffer = entry[2];
      }

      result[outerKey][innerKey] = [
        entry[0],
        entry[1],
        valBuffer
      ];
    }
  }
  return result;
}

// Define a file-backed checkpointer to persist checkpoints across hot-reloads and restarts
class FileCheckpointer extends MemorySaver {
  filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, "utf8");
        if (fileContent.trim()) {
          const data = JSON.parse(fileContent);
          this.storage = deserializeStorage(data.storage) || Object.create(null);
          this.writes = deserializeWrites(data.writes) || Object.create(null);
          console.log(`[FileCheckpointer] Successfully loaded checkpoints from ${this.filePath}`);
        }
      }
    } catch (err) {
      console.error("[FileCheckpointer] Failed to load checkpoints:", err);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const serializedStorage = serializeStorage(this.storage);
      const serializedWrites = serializeWrites(this.writes);
      
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ storage: serializedStorage, writes: serializedWrites }, null, 2),
        "utf8"
      );
    } catch (err) {
      console.error("[FileCheckpointer] Failed to save checkpoints:", err);
    }
  }

  async put(config: any, checkpoint: any, metadata: any) {
    const res = await super.put(config, checkpoint, metadata);
    this.save();
    return res;
  }

  async putWrites(config: any, writes: any, taskId: any) {
    const res = await super.putWrites(config, writes, taskId);
    this.save();
    return res;
  }

  async deleteThread(threadId: string) {
    await super.deleteThread(threadId);
    this.save();
  }
}

const checkpointer = new FileCheckpointer("C:\\Users\\malik\\.gemini\\antigravity\\ael_checkpoints.json");
const graph = aelGraph.compile({ checkpointer });

export async function POST(req: NextRequest) {
  try {
    const { message, threadId, approvalDecision, emailInput, modelName, history } = await req.json();

    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId parameter." }, { status: 400 });
    }

    const config = {
      configurable: {
        thread_id: threadId,
        modelName: modelName || "models/gemini-3.1-flash-lite"
      },
      recursionLimit: 100
    };
    let responseState;

    // Check if graph is currently interrupted
    let currentState = await graph.getState(config);

    // Rehydrate state if server lacks state but client has a history
    const hasExistingState = currentState.values && currentState.values.messages && currentState.values.messages.length > 0;
    if (!hasExistingState && Array.isArray(history) && history.length > 0) {
      console.log(`[Rehydrate] Thread ${threadId} state not found. Rehydrating from client history (${history.length} messages).`);
      const messagesToLoad = history.slice(0, -1).map((m: any) => ({
        role: m.role,
        content: m.content
      }));
      if (messagesToLoad.length > 0) {
        await graph.updateState(config, {
          messages: messagesToLoad
        });
        // Fetch refreshed state
        currentState = await graph.getState(config);
      }
    }

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
    // Case 3: Resuming from an active interrupt state via general text message
    // NOTE: Do NOT clear interruptionReason here — routeIntentNode reads it and clears it
    // internally after handling the response. Pre-clearing it breaks all interrupt routing.
    else if (hasInterrupt && message) {
      await graph.updateState(config, {
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
    const finalState = responseState || (await graph.getState(config)).values || {};
    const messages = finalState.messages || [];
    const lastMessage = messages[messages.length - 1];

    try {
      const fs = require("fs");
      const logPath = "C:\\Users\\malik\\.gemini\\antigravity\\brain\\a0f1e6b0-697a-4254-8120-5e46f9fdafec\\scratch\\state_log.json";
      fs.writeFileSync(logPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        currentStateValues: currentState.values,
        finalStateValues: finalState,
      }, null, 2));
    } catch (fsErr) {
      console.error("Failed to write state log:", fsErr);
    }
    
    return NextResponse.json({
      success: true,
      reply: lastMessage?.content || "No reply generated.",
      messages: messages.map((m: any) => ({
        role: m.role || (m.constructor.name === "HumanMessage" ? "user" : "assistant"),
        content: m.content
      })),
      interruptionReason: finalState.interruptionReason,
      pendingAction: finalState.pendingAction
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
