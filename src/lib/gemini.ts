import { GoogleGenAI } from '@google/genai';

export async function generateAcademicContent(prompt: string) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
    });
    return response.text || '';
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "% Error generating content. Please check API key and quota.";
  }
}
