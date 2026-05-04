import { GoogleGenAI } from "@google/genai";
import { LeaveLog } from "../types";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

// Exponential backoff helper
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (maxRetries <= 0) throw error;
    console.warn(`Retrying operation... Attempts left: ${maxRetries}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return retryOperation(operation, maxRetries - 1, delayMs * 2);
  }
}

export const generateLeaveSummary = async (logs: LeaveLog[]): Promise<string> => {
  if (logs.length === 0) return "No leave records found for the last 30 days.";

  // Format data for the prompt
  const logSummary = logs.map(log =>
    `- ${log.dateString}: ${log.staffName} took ${log.duration} days of ${log.type}`
  ).join('\n');

  const prompt = `
    Analyze the following leave logs for the last 30 days and provide a concise summary.
    Focus on:
    1. Key trends and leave patterns (e.g., frequency, specific days of the week).
    2. Distribution of leave types (AL vs ML vs others).
    3. Any notable observations regarding leave duration or frequency.
    
    Keep the tone professional yet conversational and encouraging. Use "User" or direct address if summarizing for an individual, or "Team" if multiple people are listed.
    
    Logs:
    ${logSummary}
  `;

  return retryOperation(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    return response.text || "Could not generate summary.";
  });
};
