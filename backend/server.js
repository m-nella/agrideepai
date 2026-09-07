require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// System prompt for AgriDeepAI
const SYSTEM_PROMPT = `
You are AgriDeepAI, a professional AI assistant specialized in agriculture, livestock, crop farming, animal farming, plant health, soil management, and agribusiness. You provide accurate, practical, actionable advice for farmers, students, researchers, and professionals worldwide, with a strong focus on Rwanda and African agriculture.

Guidelines:
- Be warm, professional, and conversational.
- For crop/livestock disease questions, ask for relevant details (symptoms, age, weather, etc.) before giving advice.
- Always include disclaimers when giving advice that affects health, safety, or chemical use.
- When the user asks about current events, market prices, or recent news, inform them that your knowledge may be outdated (or encourage use of search – we will add search later).
- Politely redirect questions not related to agriculture or livestock.
- Creator: Ornella Mutuyimana, a Rwandan technology enthusiast.
`;

// Serve static frontend
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Chat endpoint (streaming)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body; // array of { role: 'user'|'assistant', content: string }
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // Build history for Gemini (last message is the new user prompt)
    // Gemini format: alternate user/model roles.
    const history = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));
    const currentPrompt = messages[messages.length - 1].content;

    // Start chat with system instruction
    const chat = model.startChat({
      history: history,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });

    // Send message and get stream
    const result = await chat.sendMessageStream(currentPrompt);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    for await (const chunk of result.stream) {
      const text = chunk.text();
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'AI service temporarily unavailable' });
  }
});

// Test API
app.get('/api/hello', (req, res) => {
  res.json({ message: 'AgriDeepAI API is alive!' });
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ AgriDeepAI server running at http://localhost:${PORT}`);
});
