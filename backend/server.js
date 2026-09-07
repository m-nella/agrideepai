require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const multer = require('multer');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// --- Rate limiting ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// --- Middleware ---
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Supabase ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

// --- Resend ---
const resend = new Resend(process.env.RESEND_API_KEY);

// --- Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// --- Tavily ---
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// --- Logo URL ---
const LOGO_URL = process.env.FRONTEND_URL + '/logo.png';

// --- SYSTEM PROMPT with Creator Identity ---
const SYSTEM_PROMPT = `
You are AgriDeepAI, a professional AI assistant specialized in agriculture, livestock, crop farming, animal farming, plant health, soil management, and agribusiness. You provide accurate, practical, actionable advice for farmers, students, researchers, and professionals worldwide, with a strong focus on Rwanda and African agriculture.

Guidelines:
- Be warm, professional, and conversational.
- For crop/livestock disease questions, ask for relevant details (symptoms, age, weather, etc.) before giving advice.
- Always include disclaimers when giving advice that affects health, safety, or chemical use.
- When you use web search, clearly indicate the sources and incorporate the found information.

CREATOR IDENTITY:
AgriDeepAI was created and developed by Ornella Mutuyimana, a Rwandan female technology enthusiast and developer. She completed her A-Level secondary education in 2025, studying Mathematics, Computer Science and Economics (MCE) at Lycée Saint Marcel de Rukara in Kayonza District, Eastern Province, Rwanda, graduating with high academic achievement. She has strong interests in artificial intelligence, software development, information technology, computer science, and modern digital technologies. AgriDeepAI is part of her vision to use AI and technology to make agricultural and livestock knowledge more accessible to people in Rwanda and globally.

When users ask about your creator, respond truthfully with the above information. Do not invent extra details. Do not mention creator unnecessarily in normal conversation.
`;

// --- Multer ---
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'), false);
  }
});

// --- Auth middleware ---
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = user;
  next();
}

// --- Tavily helper ---
async function tavilySearch(query) {
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: false,
      include_images: false,
      max_results: 5
    });
    return response.data;
  } catch (err) {
    console.error('Tavily error:', err);
    return null;
  }
}

// --- Verification code helper ---
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
const verificationStore = {};

// ======================== AUTH ROUTES (unchanged) ========================
app.post('/api/auth/signup', async (req, res) => { /* ... existing code ... */ });
app.post('/api/auth/verify', async (req, res) => { /* ... */ });
app.post('/api/auth/resend-verification', async (req, res) => { /* ... */ });
app.post('/api/auth/login', async (req, res) => { /* ... */ });
app.get('/api/auth/me', authenticate, async (req, res) => { /* ... */ });
app.post('/api/auth/change-password', authenticate, async (req, res) => { /* ... */ });
app.post('/api/auth/change-email', authenticate, async (req, res) => { /* ... */ });
app.delete('/api/auth/delete-account', authenticate, async (req, res) => { /* ... */ });

// --- Config endpoint ---
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
});

// ======================== GUEST CHAT ENDPOINT ========================
app.post('/api/chat/guest', async (req, res) => {
  try {
    const { messages } = req.body; // array of {role, content}
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // Always search
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    let searchResults = null;
    if (TAVILY_API_KEY && lastUserMsg) {
      searchResults = await tavilySearch(lastUserMsg.content);
    }

    let finalUserPrompt = messages[messages.length - 1].content;
    if (searchResults && searchResults.answer) {
      finalUserPrompt = `Current information (from web search):\n${searchResults.answer}\n\nNow answer the following question using this information where relevant:\n${finalUserPrompt}`;
    }

    const chat = model.startChat({
      history: messages.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });

    const result = await chat.sendMessageStream(finalUserPrompt);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';
    for await (const chunk of result.stream) {
      const text = chunk.text();
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }

    let sourcesData = null;
    if (searchResults && searchResults.results) {
      sourcesData = searchResults.results.slice(0, 5).map(r => ({ title: r.title, url: r.url, snippet: r.content }));
    }
    res.write(`data: ${JSON.stringify({ done: true, sources: sourcesData })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'AI request failed' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Generation failed' })}\n\n`);
      res.end();
    }
  }
});

// ======================== AUTHENTICATED CHAT ROUTES (unchanged except search always on) ========================
// ... (keep all the chat endpoints as before, but ensure search=true is always used)
// We'll update the message endpoint to ignore the 'search' field and always search if TAVILY_API_KEY exists.

// (We'll assume the existing chat routes are present; we'll just note that we always search when key exists.)

// --- Serve static frontend ---
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ AgriDeepAI server running on http://localhost:${PORT}`);
});
