import { GoogleGenAI } from "@google/genai";
import { LeaveLog } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
    Analyze the following leave logs for the last 30 days and provide a concise executive summary for an HR manager.
    Focus on:
    1. Who is taking the most leave?
    2. Are there any patterns (e.g., frequent Mondays, specific departments implied)?
    3. Any anomalies or high usage of Medical Leave (ML)?
    
    Keep the tone professional yet conversational.
    
    Logs:
    ${logSummary}
  `;

  return retryOperation(async () => {
    // Using gemini-3-flash-preview as recommended for text tasks in this environment
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    
    return response.text || "Could not generate summary.";
  });
};
