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

// --- Middleware ---
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Rate Limiting ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// --- Supabase ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

// --- Resend ---
const resend = new Resend(process.env.RESEND_API_KEY);

// --- Google Gemini with Model Fallback ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// List of models to try in order (newest to oldest)
const MODEL_NAMES = [
  'gemini-2.0-flash-exp',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-pro',
  'gemini-1.0-pro'
];

let activeModel = null;

function getModel() {
  if (activeModel) return activeModel;
  for (const name of MODEL_NAMES) {
    try {
      const model = genAI.getGenerativeModel({ model: name });
      // Test the model with a small request
      console.log(`✅ Using Gemini model: ${name}`);
      activeModel = model;
      return model;
    } catch (e) {
      console.warn(`⚠️ Model ${name} not available, trying next...`);
    }
  }
  // Fallback: try the first one again (will throw a clear error)
  activeModel = genAI.getGenerativeModel({ model: MODEL_NAMES[0] });
  return activeModel;
}

const model = getModel();

// --- Tavily ---
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// --- Logo URL ---
const LOGO_URL = process.env.FRONTEND_URL + '/logo.png';

// --- SYSTEM PROMPT (with Creator Identity) ---
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

// --- Multer for file uploads ---
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

// --- Auth Middleware ---
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

// --- Tavily Search Helper ---
async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return null;
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

// --- Verification Code Helper ---
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
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
        <div style="text-align:center;font-family:sans-serif;">
          <img src="${LOGO_URL}" alt="AgriDeepAI" style="height:60px;margin-bottom:1rem;" />
          <h1>Welcome to AgriDeepAI!</h1>
          <p>Your verification code is:</p>
          <h2 style="background:#f0f0f0;padding:0.5rem;border-radius:8px;display:inline-block;font-family:monospace;">${code}</h2>
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
        <div style="text-align:center;font-family:sans-serif;">
          <img src="${LOGO_URL}" alt="AgriDeepAI" style="height:60px;margin-bottom:1rem;" />
          <h1>Verification Code</h1>
          <h2 style="background:#f0f0f0;padding:0.5rem;border-radius:8px;display:inline-block;font-family:monospace;">${code}</h2>
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
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// ======================== GUEST CHAT ENDPOINT ========================
app.post('/api/chat/guest', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // Get the current model (with fallback)
    const chatModel = getModel();

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

    const chat = chatModel.startChat({
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
    console.error('Guest chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'AI request failed' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Generation failed' })}\n\n`);
      res.end();
    }
  }
});

// ======================== AUTHENTICATED CHAT ROUTES ========================
app.get('/api/chat/conversations', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

app.post('/api/chat/conversations', authenticate, async (req, res) => {
  try {
    const { title } = req.body;
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: req.user.id, title: title || 'New Chat' })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

app.put('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, pinned, archived } = req.body;
    const { data: existing, error: checkErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (checkErr || !existing) return res.status(404).json({ error: 'Conversation not found' });
    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (pinned !== undefined) updates.pinned = pinned;
    if (archived !== undefined) updates.archived = archived;
    const { data, error } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

app.delete('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.get('/api/chat/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (convErr || !conv) return res.status(404).json({ error: 'Conversation not found' });
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// --- Send message (authenticated) ---
app.post('/api/chat/conversations/:id/messages', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { message } = req.body;
    const file = req.file;

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single();
    if (convErr || !conv) return res.status(404).json({ error: 'Conversation not found' });

    // Handle file upload
    let fileMetadata = null;
    if (file) {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${req.user.id}/${fileName}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(storageBucket)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (uploadErr) throw new Error('File upload failed: ' + uploadErr.message);
      const { publicURL, error: urlErr } = supabase.storage
        .from(storageBucket)
        .getPublicUrl(filePath);
      if (urlErr) throw new Error('Failed to get file URL');
      fileMetadata = {
        filename: file.originalname,
        storage_path: filePath,
        mime_type: file.mimetype,
        size: file.size,
        public_url: publicURL,
      };
    }

    // Save user message
    const messageData = {
      conversation_id: conversationId,
      role: 'user',
      content: message || '',
    };
    if (fileMetadata) {
      messageData.files = [fileMetadata];
    }
    const { data: userMsg, error: msgErr } = await supabase
      .from('messages')
      .insert(messageData)
      .select()
      .single();
    if (msgErr) throw msgErr;

    // Fetch history
    const { data: history, error: histErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (histErr) throw histErr;

    // Search
    let searchResults = null;
    if (TAVILY_API_KEY) {
      const query = message || 'agriculture update';
      searchResults = await tavilySearch(query);
    }

    // Build AI messages
    let aiMessages = history.map(m => ({ role: m.role, content: m.content }));
    let finalUserPrompt = aiMessages[aiMessages.length - 1].content;
    if (searchResults && searchResults.answer) {
      finalUserPrompt = `Current information (from web search):\n${searchResults.answer}\n\nNow answer the following question using this information where relevant:\n${finalUserPrompt}`;
    }

    // Get model
    const chatModel = getModel();

    // Vision support for images
    let visionModel = chatModel;
    let imageParts = [];
    if (file && file.mimetype.startsWith('image/')) {
      const base64Image = file.buffer.toString('base64');
      imageParts = [{
        inlineData: { data: base64Image, mimeType: file.mimetype }
      }];
    }

    const chat = visionModel.startChat({
      history: aiMessages.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });

    let result;
    if (imageParts.length > 0) {
      result = await chat.sendMessageStream([{ text: finalUserPrompt }, ...imageParts]);
    } else {
      result = await chat.sendMessageStream(finalUserPrompt);
    }

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

    // Save assistant message
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: fullResponse,
        files: sourcesData ? [{ sources: sourcesData }] : null
      });
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to send message' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Generation failed' })}\n\n`);
      res.end();
    }
  }
});

// --- Regenerate endpoint ---
app.post('/api/chat/conversations/:id/regenerate', authenticate, async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { messageIndex } = req.body;
    if (messageIndex === undefined || typeof messageIndex !== 'number') {
      return res.status(400).json({ error: 'messageIndex required (number)' });
    }
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single();
    if (convErr || !conv) return res.status(404).json({ error: 'Conversation not found' });

    const { data: allMessages, error: fetchErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (fetchErr) throw fetchErr;

    if (messageIndex >= allMessages.length) {
      return res.status(400).json({ error: 'Index out of bounds' });
    }
    if (allMessages[messageIndex].role !== 'assistant') {
      return res.status(400).json({ error: 'Message at index is not an assistant message' });
    }

    const idsToDelete = allMessages.slice(messageIndex).map(m => m.id);
    if (idsToDelete.length > 0) {
      await supabase.from('messages').delete().in('id', idsToDelete);
    }

    const { data: remaining, error: remErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (remErr) throw remErr;

    const aiMessages = remaining.map(m => ({ role: m.role, content: m.content }));
    if (aiMessages.length === 0 || aiMessages[aiMessages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'No user message to regenerate from' });
    }

    const chatModel = getModel();
    const chat = chatModel.startChat({
      history: aiMessages.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });
    const result = await chat.sendMessageStream(aiMessages[aiMessages.length - 1].content);

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
    res.write('data: [DONE]\n\n');
    res.end();

    await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'assistant', content: fullResponse });
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Regeneration failed' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Regeneration failed' })}\n\n`);
      res.end();
    }
  }
});

// --- Edit message endpoint ---
app.put('/api/chat/messages/:id', authenticate, async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { content, truncate } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });
    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .select('*, conversation_id, conversations(user_id)')
      .eq('id', messageId)
      .single();
    if (msgErr || !msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.conversations.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (msg.role !== 'user') {
      return res.status(400).json({ error: 'Only user messages can be edited' });
    }
    const { data, error } = await supabase
      .from('messages')
      .update({ content })
      .eq('id', messageId)
      .select()
      .single();
    if (error) throw error;
    if (truncate) {
      const { data: laterMessages, error: laterErr } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', msg.conversation_id)
        .gt('created_at', msg.created_at)
        .order('created_at', { ascending: true });
      if (laterErr) throw laterErr;
      if (laterMessages.length > 0) {
        const ids = laterMessages.map(m => m.id);
        await supabase.from('messages').delete().in('id', ids);
      }
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', msg.conversation_id);
    }
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to edit message' });
  }
});

// --- Serve static frontend ---
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ AgriDeepAI server running on http://localhost:${PORT}`);
  console.log(`📦 Using Gemini model with fallback support`);
});
