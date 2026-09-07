require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;

// --- Middleware ---
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Supabase (server-side client with service key for admin ops) ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// --- Resend email ---
const resend = new Resend(process.env.RESEND_API_KEY);

// --- Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const SYSTEM_PROMPT = `
You are AgriDeepAI, a professional AI assistant specialized in agriculture, livestock, crop farming, animal farming, plant health, soil management, and agribusiness. You provide accurate, practical, actionable advice for farmers, students, researchers, and professionals worldwide, with a strong focus on Rwanda and African agriculture.

Guidelines:
- Be warm, professional, and conversational.
- For crop/livestock disease questions, ask for relevant details (symptoms, age, weather, etc.) before giving advice.
- Always include disclaimers when giving advice that affects health, safety, or chemical use.
- When the user asks about current events, market prices, or recent news, inform them that your knowledge may be outdated.
- Politely redirect questions not related to agriculture or livestock.
- Creator: Ornella Mutuyimana, a Rwandan technology enthusiast.
`;

// --- Middleware: authenticate user via Bearer token ---
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

// --- Helper to generate verification code (6 digits) ---
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
// In-memory store for verification codes (replace with Redis in production)
const verificationStore = {};

// --- Auth Routes ---

// Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    // Sign up with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    });
    if (error) throw error;
    const user = data.user;
    if (!user) throw new Error('Signup failed');

    // Create profile
    await supabase.from('profiles').insert({
      id: user.id,
      full_name: fullName || email.split('@')[0]
    });

    // Generate and send verification code
    const code = generateCode();
    verificationStore[user.id] = { code, expires: Date.now() + 10 * 60 * 1000 };
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: email,
      subject: 'Verify your AgriDeepAI account',
      html: `<h1>Welcome!</h1><p>Your verification code: <strong>${code}</strong></p><p>Valid for 10 minutes.</p>`
    });
    res.status(201).json({ message: 'User created. Please verify your email.', userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Verify email
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: 'User ID and code required' });
    const stored = verificationStore[userId];
    if (!stored || stored.code !== code || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    // Confirm user's email in Supabase
    const { error } = await supabase.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) throw error;
    delete verificationStore[userId];
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Resend verification
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
      html: `<h1>Verification Code</h1><p>${code}</p>`
    });
    res.json({ message: 'Code resent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to resend' });
  }
});

// Login (uses Supabase's built-in signInWithPassword)
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

// Logout (client-side only – just clear session)
app.post('/api/auth/logout', authenticate, async (req, res) => {
  // Supabase handles session on client, but we can also invalidate
  res.json({ message: 'Logged out' });
});

// Get current user
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

// --- Chat Routes (protected) ---

// Get all conversations for the user
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

// Create a new conversation
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

// Update conversation (rename, pin, archive)
app.put('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, pinned, archived } = req.body;
    // Verify ownership
    const { data: existing, error: checkErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (checkErr || !existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
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

// Delete conversation
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

// Get messages for a conversation
app.get('/api/chat/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    // Verify ownership (optional but good)
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

// Send message (streaming) – also saves to DB
app.post('/api/chat/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { message } = req.body;
    const file = req.file; // will be handled later

    // Verify ownership
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single();
    if (convErr || !conv) return res.status(404).json({ error: 'Conversation not found' });

    // Save user message
    const { data: userMsg, error: msgErr } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'user', content: message })
      .select()
      .single();
    if (msgErr) throw msgErr;

    // Fetch conversation history (all messages)
    const { data: history, error: histErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (histErr) throw histErr;

    // Build AI messages
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    // Start Gemini streaming
    const chat = model.startChat({
      history: aiMessages.slice(0, -1).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });
    const result = await chat.sendMessageStream(aiMessages[aiMessages.length - 1].content);

    // Set SSE headers
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

    // Save assistant message after streaming
    await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'assistant', content: fullResponse });

    // Update conversation updated_at
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

  } catch (err) {
    console.error(err);
    // If headers not sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to send message' });
    } else {
      // Already streaming, send error event
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Generation failed' })}\n\n`);
      res.end();
    }
  }
});

// --- Serve static frontend ---
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ AgriDeepAI server running on http://localhost:${PORT}`);
});
