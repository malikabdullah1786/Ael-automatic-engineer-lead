const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
require("dotenv").config({ path: ".env.local" });

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.1,
});

async function run() {
  const lastMessage = "tommorrow 3 pm";
  const prompt = `You are parsing a date/time string from a developer's chat message.
Current local time is: ${new Date().toISOString()}

User message: "${lastMessage}"

Extract/parse the date and time from the user's message relative to the current local time.
Return a JSON object in this format ONLY:
{
  "parsedTime": "ISO_datetime_string_if_parsed_successfully_else_null",
  "success": true | false
}`;

  console.log("Sending prompt to Gemini...");
  const response = await model.invoke(prompt);
  console.log("Raw response content:", response.content);
  
  try {
    const cleanedText = response.content.toString().replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
    const parsed = JSON.parse(cleanedText);
    console.log("Parsed JSON:", parsed);
  } catch (err) {
    console.error("Failed to parse JSON:", err);
  }
}

run();
