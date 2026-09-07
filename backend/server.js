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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

// Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Tavily
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Logo URL for emails
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

// Multer config
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
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
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
function generateCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }
const verificationStore = {};

// ======================== AUTH ROUTES ========================
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    });
    if (error) throw error;
    const user = data.user;
    if (!user) throw new Error('Signup failed');
    await supabase.from('profiles').insert({
      id: user.id,
      full_name: fullName || email.split('@')[0]
    });
    const code = generateCode();
    verificationStore[user.id] = { code, expires: Date.now() + 10 * 60 * 1000 };
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: email,
      subject: 'Verify your AgriDeepAI account',
      html: `
        <div style="text-align:center;">
          <img src="${LOGO_URL}" alt="AgriDeepAI" style="height:60px;margin-bottom:1rem;" />
          <h1>Welcome to AgriDeepAI!</h1>
          <p>Your verification code is:</p>
          <h2 style="background:#f0f0f0;padding:0.5rem;border-radius:8px;display:inline-block;">${code}</h2>
          <p>Valid for 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `
    });
    res.status(201).json({ message: 'User created. Please verify your email.', userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: 'User ID and code required' });
    const stored = verificationStore[userId];
    if (!stored || stored.code !== code || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    const { error } = await supabase.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) throw error;
    delete verificationStore[userId];
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const { data: users, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;
    const user = users.users.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const code = generateCode();
    verificationStore[user.id] = { code, expires: Date.now() + 10 * 60 * 1000 };
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: email,
      subject: 'Verify your AgriDeepAI account',
      html: `
        <div style="text-align:center;">
          <img src="${LOGO_URL}" alt="AgriDeepAI" style="height:60px;margin-bottom:1rem;" />
          <h1>Verification Code</h1>
          <h2 style="background:#f0f0f0;padding:0.5rem;border-radius:8px;display:inline-block;">${code}</h2>
          <p>Valid for 10 minutes.</p>
        </div>
      `
    });
    res.json({ message: 'Code resent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to resend' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    res.json({ user: data.user, session: data.session });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();
    if (error) throw error;
    res.json({ user: req.user, profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: currentPassword
    });
    if (signInError) return res.status(401).json({ error: 'Current password is incorrect' });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to change password' });
  }
});

app.post('/api/auth/change-email', authenticate, async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail) return res.status(400).json({ error: 'New email required' });
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) throw error;
    res.json({ message: 'Email change requested. Please verify the new email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to change email' });
  }
});

app.delete('/api/auth/delete-account', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete account' });
  }
});

// --- Config endpoint ---
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
});

// ======================== GUEST CHAT ENDPOINT ========================
app.post('/api/chat/guest', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // Always perform search
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

// ======================== AUTHENTICATED CHAT ROUTES ========================
// (These are the same as before – we keep them unchanged)
// For brevity, we skip re‑writing them here, but they exist in your code.
// Ensure they also always perform search (ignore the 'search' flag).
// ...

// --- Serve static frontend ---
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ AgriDeepAI server running on http://localhost:${PORT}`);
});
