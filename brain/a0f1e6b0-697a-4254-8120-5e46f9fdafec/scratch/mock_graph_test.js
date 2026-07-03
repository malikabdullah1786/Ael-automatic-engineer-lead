const { StateGraph, Annotation, START, END } = require("@langchain/langgraph");

// Define state
const State = Annotation.Root({
  meetingTime: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  otherVal: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => "initial",
  })
});

// Nodes
function nodeA(state) {
  console.log("==> nodeA. current state:", state);
  return { meetingTime: "2026-07-04T15:00:00Z" };
}

function nodeB(state) {
  console.log("==> nodeB. current state:", state);
  return { otherVal: "updated_in_B" };
}

function nodeC(state) {
  console.log("==> nodeC. current state:", state);
  return {};
}

// Compile
const workflow = new StateGraph(State)
  .addNode("nodeA", nodeA)
  .addNode("nodeB", nodeB)
  .addNode("nodeC", nodeC);

workflow.addEdge(START, "nodeA");
workflow.addEdge("nodeA", "nodeB");
workflow.addEdge("nodeB", "nodeC");
workflow.addEdge("nodeC", END);

const graph = workflow.compile();

async function run() {
  console.log("Starting graph run...");
  const finalState = await graph.invoke({});
  console.log("Final state after execution:", finalState);
}

run().catch(console.error);
