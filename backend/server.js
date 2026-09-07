require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Supabase (server-side client with service key)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

// Resend email
const resend = new Resend(process.env.RESEND_API_KEY);

// Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const SYSTEM_PROMPT = `
You are AgriDeepAI, a professional AI assistant specialized in agriculture, livestock, crop farming, animal farming, plant health, soil management, and agribusiness. You provide accurate, practical, actionable advice for farmers, students, researchers, and professionals worldwide, with a strong focus on Rwanda and African agriculture.

Guidelines:
- Be warm, professional, and conversational.
- For crop/livestock disease questions, ask for relevant details (symptoms, age, weather, etc.) before giving advice.
- Always include disclaimers when giving advice that affects health, safety, or chemical use.
- When the user asks about current events, market prices, or recent news, inform them that your knowledge may be outdated (encourage use of search – coming soon).
- Politely redirect questions not related to agriculture or livestock.
- Creator: Ornella Mutuyimana, a Rwandan technology enthusiast.
`;

// --- Multer configuration (memory storage) ---
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    // Allow images, PDF, text, and common document types
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'), false);
    }
  }
});

// --- Middleware: authenticate user ---
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

// --- Helper to generate verification code ---
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
const verificationStore = {};

// --- Auth Routes (unchanged from Phase 4) ---
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
      html: `<h1>Welcome!</h1><p>Your verification code: <strong>${code}</strong></p><p>Valid for 10 minutes.</p>`
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
      html: `<h1>Verification Code</h1><p>${code}</p>`
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

// --- Config endpoint ---
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// --- Chat Routes (protected) ---

// Get conversations, create, update, delete – same as Phase 4
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

// --- SEND MESSAGE with FILE UPLOAD ---
app.post('/api/chat/conversations/:id/messages', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { message } = req.body;
    const file = req.file;

    // Verify ownership
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single();
    if (convErr || !conv) return res.status(404).json({ error: 'Conversation not found' });

    // Handle file upload to Supabase Storage
    let fileMetadata = null;
    let filePublicUrl = null;
    if (file) {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${req.user.id}/${fileName}`;
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(storageBucket)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (uploadErr) throw new Error('File upload failed: ' + uploadErr.message);
      // Get public URL
      const { publicURL, error: urlErr } = supabase.storage
        .from(storageBucket)
        .getPublicUrl(filePath);
      if (urlErr) throw new Error('Failed to get file URL');
      filePublicUrl = publicURL;
      fileMetadata = {
        filename: file.originalname,
        storage_path: filePath,
        mime_type: file.mimetype,
        size: file.size,
        public_url: publicURL,
      };
      // Save file metadata to database (optional)
      await supabase.from('files').insert({
        user_id: req.user.id,
        filename: file.originalname,
        storage_path: filePath,
        mime_type: file.mimetype,
        size: file.size,
      });
    }

    // Save user message with file info
    const messageData = {
      conversation_id: conversationId,
      role: 'user',
      content: message || '',
    };
    if (fileMetadata) {
      messageData.files = [fileMetadata]; // store as JSON array
    }
    const { data: userMsg, error: msgErr } = await supabase
      .from('messages')
      .insert(messageData)
      .select()
      .single();
    if (msgErr) throw msgErr;

    // Fetch conversation history
    const { data: history, error: histErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (histErr) throw histErr;

    // Build AI messages
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    // Prepare for Gemini: if we have an image, we need to use vision model.
    let visionModel = model;
    let imageParts = [];
    if (file && file.mimetype.startsWith('image/')) {
      // Use Gemini vision model
      visionModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // supports vision
      // Convert image to base64
      const base64Image = file.buffer.toString('base64');
      imageParts = [{
        inlineData: { data: base64Image, mimeType: file.mimetype }
      }];
    }

    // Start chat with history
    const chat = visionModel.startChat({
      history: aiMessages.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });

    // Send message – if we have image, we need to send both text and image.
    let result;
    if (imageParts.length > 0) {
      // Combine user text and image
      const userMessage = aiMessages[aiMessages.length - 1].content;
      // For vision, we send an array of parts: text and image
      result = await chat.sendMessageStream([
        { text: userMessage },
        ...imageParts
      ]);
    } else {
      result = await chat.sendMessageStream(aiMessages[aiMessages.length - 1].content);
    }

    // Stream response
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

    // Save assistant message
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
      res.status(500).json({ error: err.message || 'Failed to send message' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Generation failed' })}\n\n`);
      res.end();
    }
  }
});

// --- Regenerate endpoint (same as Phase 4, but without file handling; can be extended later) ---
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

    const chat = model.startChat({
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

// --- Edit message (same as Phase 4) ---
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
});
