const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const { log } = require('./logger');

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function solveQuestion(questionText) {
    log('INFO', 'Sending question to Gemini', { question: questionText.substring(0, 50) });
    const prompt = `Solve this math problem. Return ONLY the final answer. No steps, no explanation, no markdown formatting.\nQuestion: ${questionText}`;
    try {
        const result = await model.generateContent(prompt);
        const answer = result.response.text().trim().replace(/["']/g, '');
        log('INFO', 'Gemini returned answer', { answer });
        return answer;
    } catch (error) {
        log('ERROR', 'Gemini API error', { error: error.message });
        return null;
    }
}

module.exports = { solveQuestion };
