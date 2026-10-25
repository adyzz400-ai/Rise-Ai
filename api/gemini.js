// api/gemini.js
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export async function solveQuestion(text, options = null, type) {
    let prompt = `Return ONLY the final answer, no explanation, no markdown.\nQuestion: ${text}\n`;
    
    if (type === 'choice' && options) {
        prompt += `Options:\n${options.map(o => `- ${o.text}`).join('\n')}\nReturn the exact text of the correct option.`;
    } else if (type === 'cards' && options) {
        prompt += `Options:\n${options.map(o => `- ${o.ref}: ${o.text}`).join('\n')}\nReturn a JSON object mapping the required slot IDs to the correct card refs. Example: {"XFR": "LGB", "XAM": "VMX"}`;
    } else if (type === 'number' || type === 'text') {
        prompt += `Provide the exact value to fill in the blank.`;
    }
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (err) {
        console.error('Gemini API Error:', err);
        return null;
    }
}
