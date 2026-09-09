require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const Groq = require('groq-sdk');

// ---------- Brevo Email ----------
const brevo = require('@getbrevo/brevo');
const defaultClient = brevo.ApiClient.instance;
const apiKeyAuth = defaultClient.authentications['api-key'];
if (apiKeyAuth) {
  apiKeyAuth.apiKey = process.env.BREVO_API_KEY || '';
}
const brevoApi = new brevo.TransactionalEmailsApi();

// ---------- Logging ----------
const log = (msg, type = 'info') => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${msg}`);
};

// ---------- App ----------
const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------- Rate Limiting ----------
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ---------- Supabase ----------
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

// ---------- Groq (free, no card) ----------
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ---------- Dynamic Model Discovery (chat models only) ----------
let availableModels = [];
let workingModel = null;

async function discoverModels() {
  if (availableModels.length > 0) return availableModels;
  try {
    const response = await groq.models.list();
    const allModels = response.data.map(m => m.id);
    // Filter for chat-capable models: must contain 'llama' or 'mixtral' or 'gemma'
    // but exclude guard, embed, prompt‑guard
    const chatModels = allModels.filter(id =>
      (id.includes('llama') || id.includes('mixtral') || id.includes('gemma')) &&
      !id.includes('guard') &&
      !id.includes('embed') &&
      !id.includes('prompt')
    );
    // Prefer models with 'versatile' or 'instant'
    const preferred = chatModels.filter(m => m.includes('versatile') || m.includes('instant'));
    availableModels = preferred.length > 0 ? preferred : chatModels;
    log(`Discovered chat models: ${availableModels.join(', ')}`, 'info');
    return availableModels;
  } catch (err) {
    log(`Failed to discover models: ${err.message}`, 'error');
    // Fallback to known working models
    availableModels = ['llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
    return availableModels;
  }
}

async function getWorkingModel() {
  if (workingModel) return workingModel;
  const candidates = await discoverModels();
  for (const model of candidates) {
    try {
      // Quick test with minimal request
      const test = await groq.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      });
      if (test.choices && test.choices.length > 0) {
        workingModel = model;
        log(`✅ Cached working chat model: ${model}`, 'info');
        return model;
      }
    } catch (err) {
      log(`⚠️ Model ${model} failed: ${err.message}`, 'warn');
    }
  }
  throw new Error('No working chat models found. Check your Groq API key.');
}

// ---------- Tavily ----------
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ---------- Logo URL ----------
const LOGO_URL = process.env.FRONTEND_URL + '/logo.png';

// ---------- System Prompt (shortened creator info) ----------
const SYSTEM_PROMPT = `
You are AgriDeepAI, a professional AI assistant specialized in agriculture, livestock, crop farming, animal farming, plant health, soil management, and agribusiness. Provide practical, accurate, actionable advice, with focus on Rwanda and African agriculture.

**BEHAVIOR:**
- Be warm, professional, and conversational.
- For crop/livestock disease questions, ask for details (symptoms, age, weather, etc.) before giving advice.
- Always include disclaimers for health, safety, or chemical use.

**RESPONSE FORMATTING (MANDATORY):**
To ensure your answers are professional and readable, you **MUST** use Markdown formatting. Structure your responses as follows:

1. **Start with a clear heading** – use \`#\` for the main title if the answer is long, or \`##\` for subheadings.
2. **Use bullet points** (\`-\` or \`*\`) for lists.
3. **Use numbered lists** (\`1.\`, \`2.\`, etc.) for steps or sequential items.
4. **Use tables** (Markdown table syntax) to compare or present structured data.
5. **Use bold** (\`**bold**\`) for emphasis and *italic* (\`*italic*\`) for less emphasis.
6. **Separate sections** with blank lines.
7. **Keep paragraphs short** – one idea per paragraph.

**CREATOR IDENTITY (keep it concise):**
AgriDeepAI was created by **Ornella Mutuyimana**, a Rwandan technology enthusiast. Her vision is to make agricultural knowledge accessible to everyone. When asked about your creator, give a brief, friendly answer and offer further help.

**IMPORTANT:** When a user asks "who made you?" respond with a short, conversational answer (2‑3 sentences) and then offer to help with agriculture or livestock. Do not list details unless the user asks for more.
`;

// ---------- Multer ----------
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

// ---------- Auth Middleware ----------
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

// ---------- Tavily helper ----------
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
    log(`Tavily error: ${err.message}`, 'error');
    return null;
  }
}

// ---------- Verification code store ----------
function generateCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }
const verificationStore = {};

// ======================== EMAIL HELPER (Brevo, professional) ========================

async function sendVerificationEmail(email, code) {
  try {
    const logoUrl = LOGO_URL;
    const expiration = '10 minutes';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>Verify your AgriDeepAI account</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .logo { text-align: center; margin-bottom: 20px; }
        .logo img { height: 60px; }
        h1 { color: #1e232a; font-size: 24px; margin: 0 0 8px; }
        p { color: #555; font-size: 16px; line-height: 1.6; }
        .code { font-size: 28px; font-weight: bold; color: #2f8f46; background: #f0f8f0; padding: 10px 20px; border-radius: 8px; display: inline-block; letter-spacing: 4px; margin: 10px 0; }
        .footer { margin-top: 30px; font-size: 13px; color: #888; border-top: 1px solid #eee; padding-top: 20px; text-align: center; }
      </style>
      </head>
      <body>
        <div class="container">
          <div class="logo"><img src="${logoUrl}" alt="AgriDeepAI" /></div>
          <h1>Welcome to AgriDeepAI!</h1>
          <p>Thanks for signing up. Use the code below to verify your email.</p>
          <div style="text-align: center;"><span class="code">${code}</span></div>
          <p><strong>This code is valid for ${expiration}.</strong> If you didn't request this, ignore this email.</p>
          <div class="footer">&copy; 2026 AgriDeepAI. All rights reserved.</div>
        </div>
      </body>
      </html>
    `;

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = 'Verify your AgriDeepAI account';
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = { name: 'AgriDeepAI', email: 'noreply@agrideepai.agentdomains.co' };
    sendSmtpEmail.to = [{ email }];
    await brevoApi.sendTransacEmail(sendSmtpEmail);
    log(`Verification email sent to ${email}`, 'info');
  } catch (err) {
    log(`Email send error: ${err.message}`, 'error');
    throw err;
  }
}

// ======================== AUTH ROUTES ========================

app.post('/api/auth/signup', async (req, res) => {
  log('Signup attempt', 'info');
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
    }
    // Disable Supabase email confirmation; we handle it ourselves
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || email.split('@')[0] },
        email_confirm: false, // prevent Supabase from sending its own email
      }
    });
    if (error) throw error;
    const user = data.user;
    if (!user) throw new Error('Signup failed');
    await supabase.from('profiles').insert({ id: user.id, full_name: fullName || email.split('@')[0] });

    const code = generateCode();
    verificationStore[user.id] = { code, expires: Date.now() + 10 * 60 * 1000 };

    await sendVerificationEmail(email, code);

    log(`Signup successful for ${email}`, 'info');
    res.status(201).json({ message: 'User created. Verify email.', userId: user.id });
  } catch (err) {
    log(`Signup error: ${err.message}`, 'error');
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  log('Verification attempt', 'info');
  try {
    const { userId, code } = req.body;
    const stored = verificationStore[userId];
    if (!stored || stored.code !== code || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    // Confirm the user's email via admin API
    await supabase.auth.admin.updateUserById(userId, { email_confirm: true });
    delete verificationStore[userId];
    log(`User ${userId} verified`, 'info');
    res.json({ message: 'Email verified' });
  } catch (err) {
    log(`Verification error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  log('Resend verification', 'info');
  try {
    const { email } = req.body;
    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users.users.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const code = generateCode();
    verificationStore[user.id] = { code, expires: Date.now() + 10 * 60 * 1000 };
    await sendVerificationEmail(email, code);
    res.json({ message: 'Code resent' });
  } catch (err) {
    log(`Resend error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to resend' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  log('Login attempt', 'info');
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    log(`User ${email} logged in`, 'info');
    res.json({ user: data.user, session: data.session });
  } catch (err) {
    log(`Login error: ${err.message}`, 'warn');
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
    res.json({ user: req.user, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: currentPassword
    });
    if (signInError) return res.status(401).json({ error: 'Current password incorrect' });
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
    }
    await supabase.auth.updateUser({ password: newPassword });
    log(`Password changed for ${req.user.email}`, 'info');
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/change-email', authenticate, async (req, res) => {
  try {
    const { newEmail } = req.body;
    await supabase.auth.updateUser({ email: newEmail });
    log(`Email change requested for ${req.user.email} -> ${newEmail}`, 'info');
    res.json({ message: 'Email change requested. Please verify the new email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/auth/delete-account', authenticate, async (req, res) => {
  try {
    await supabase.auth.admin.deleteUser(req.user.id);
    log(`Account deleted for ${req.user.email}`, 'info');
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// ======================== GUEST CHAT ========================

app.post('/api/chat/guest', async (req, res) => {
  log('Guest chat request', 'debug');
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }

    // Creator question detection – short, friendly response
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      const question = lastUserMsg.content.toLowerCase();
      const creatorKeywords = ['who made you', 'who built you', 'who created you', 'who is your creator', 'who is your developer', 'who is behind', 'who founded', 'who develops', 'who is the creator of', 'who is the developer of', 'who made this', 'who built this', 'who created this'];
      if (creatorKeywords.some(keyword => question.includes(keyword))) {
        const creatorResponse = `
I was created by **Ornella Mutuyimana**, a Rwandan technology enthusiast who is passionate about using AI to help farmers and livestock keepers. How can I assist you today with agriculture or livestock?

Feel free to ask about:
- Crop disease diagnosis
- Livestock health
- Yield improvement
- Farm planning
        `.trim();

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const words = creatorResponse.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? words[i] : ' ' + words[i]);
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
          await new Promise(r => setTimeout(r, 20));
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        log('Guest chat completed (creator question)', 'info');
        return;
      }
    }

    // Normal flow – get a working chat model
    const model = await getWorkingModel();

    let searchResults = null;
    if (TAVILY_API_KEY && lastUserMsg) {
      searchResults = await tavilySearch(lastUserMsg.content);
    }

    let finalPrompt = messages[messages.length - 1].content;
    if (searchResults && searchResults.answer) {
      finalPrompt = `Current information (from web search):\n${searchResults.answer}\n\nNow answer the following question using this information where relevant:\n${finalPrompt}`;
    }

    const history = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
    ];

    // Use max_tokens = 512 to avoid any model-specific limits
    const stream = await groq.chat.completions.create({
      model: model,
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 512,          // safe for all models
      stream: true,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    log('Guest chat completed', 'debug');
  } catch (err) {
    log(`Guest chat error: ${err.message}`, 'error');
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
});

// ======================== AUTHENTICATED CHAT ========================

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, pinned, archived } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (pinned !== undefined) updates.pinned = pinned;
    if (archived !== undefined) updates.archived = archived;
    const { data, error } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    await supabase
      .from('conversations')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chat/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat/conversations/:id/messages', authenticate, upload.single('file'), async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { message } = req.body;
    const file = req.file;

    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // Creator question (short response)
    if (message) {
      const question = message.toLowerCase();
      const creatorKeywords = ['who made you', 'who built you', 'who created you', 'who is your creator', 'who is your developer', 'who is behind', 'who founded', 'who develops', 'who is the creator of', 'who is the developer of', 'who made this', 'who built this', 'who created this'];
      if (creatorKeywords.some(keyword => question.includes(keyword))) {
        await supabase.from('messages').insert({ conversation_id: conversationId, role: 'user', content: message || '' });

        const creatorResponse = `
I was created by **Ornella Mutuyimana**, a Rwandan technology enthusiast who is passionate about using AI to help farmers and livestock keepers. How can I assist you today with agriculture or livestock?

Feel free to ask about:
- Crop disease diagnosis
- Livestock health
- Yield improvement
- Farm planning
        `.trim();

        await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: creatorResponse,
            versions: [creatorResponse],
            current_version_index: 0,
          });
        await supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const words = creatorResponse.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? words[i] : ' ' + words[i]);
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
          await new Promise(r => setTimeout(r, 20));
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        log('Authenticated chat completed (creator question)', 'info');
        return;
      }
    }

    // Normal flow
    let fileMetadata = null;
    if (file) {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${req.user.id}/${fileName}`;
      const { data: uploadData } = await supabase.storage
        .from(storageBucket)
        .upload(filePath, file.buffer, { contentType: file.mimetype });
      const { publicURL } = supabase.storage.from(storageBucket).getPublicUrl(filePath);
      fileMetadata = {
        filename: file.originalname,
        storage_path: filePath,
        mime_type: file.mimetype,
        size: file.size,
        public_url: publicURL,
      };
      await supabase.from('files').insert({
        user_id: req.user.id,
        filename: file.originalname,
        storage_path: filePath,
        mime_type: file.mimetype,
        size: file.size,
      });
    }

    const messageData = {
      conversation_id: conversationId,
      role: 'user',
      content: message || '',
    };
    if (fileMetadata) messageData.files = [fileMetadata];
    await supabase.from('messages').insert(messageData);

    const { data: history } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    let searchResults = null;
    if (TAVILY_API_KEY) {
      searchResults = await tavilySearch(message || 'agriculture update');
    }

    let finalPrompt = aiMessages[aiMessages.length - 1].content;
    if (searchResults && searchResults.answer) {
      finalPrompt = `Current information (from web search):\n${searchResults.answer}\n\nNow answer:\n${finalPrompt}`;
    }

    const model = await getWorkingModel();
    const chatHistory = aiMessages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...chatHistory,
      { role: 'user', content: finalPrompt }
    ];

    const stream = await groq.chat.completions.create({
      model: model,
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 512,
      stream: true,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: fullResponse,
        versions: [fullResponse],
        current_version_index: 0,
      });
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    log(`Message saved for conversation ${conversationId}`, 'debug');
  } catch (err) {
    log(`Send message error: ${err.message}`, 'error');
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
});

app.post('/api/chat/conversations/:id/regenerate', authenticate, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { messageIndex } = req.body;
    const { data: allMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (messageIndex >= allMessages.length || allMessages[messageIndex].role !== 'assistant')
      return res.status(400).json({ error: 'Invalid index' });

    const idsToDelete = allMessages.slice(messageIndex).map(m => m.id);
    if (idsToDelete.length > 0) await supabase.from('messages').delete().in('id', idsToDelete);

    const { data: remaining } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    const aiMessages = remaining.map(m => ({ role: m.role, content: m.content }));
    if (aiMessages.length === 0 || aiMessages[aiMessages.length - 1].role !== 'user')
      return res.status(400).json({ error: 'No user message' });

    const model = await getWorkingModel();
    const chatHistory = aiMessages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    const userPrompt = aiMessages[aiMessages.length - 1].content;
    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...chatHistory,
      { role: 'user', content: userPrompt }
    ];

    const stream = await groq.chat.completions.create({
      model: model,
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 512,
      stream: true,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
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

    log(`Regenerated for conversation ${conversationId}`, 'debug');
  } catch (err) {
    log(`Regenerate error: ${err.message}`, 'error');
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
});

app.put('/api/chat/messages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, truncate } = req.body;
    const { data: msg } = await supabase
      .from('messages')
      .select('*, conversation_id, conversations(user_id)')
      .eq('id', id)
      .single();
    if (!msg || msg.conversations.user_id !== req.user.id)
      return res.status(403).json({ error: 'Unauthorized' });
    if (msg.role !== 'user') return res.status(400).json({ error: 'Only user messages can be edited' });

    await supabase.from('messages').update({ content }).eq('id', id);
    if (truncate) {
      const { data: later } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', msg.conversation_id)
        .gt('created_at', msg.created_at);
      if (later.length) await supabase.from('messages').delete().in('id', later.map(m => m.id));
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', msg.conversation_id);
    }
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== SHARE (Authenticated + Guest) ========================

// Authenticated share – uses conversation_id in shared_links
app.post('/api/chat/share/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    const token = crypto.randomBytes(16).toString('hex');
    const { data, error } = await supabase
      .from('shared_links')
      .insert({ conversation_id: id, token })
      .select()
      .single();
    if (error) throw error;
    const shareUrl = `${process.env.FRONTEND_URL}/share/${token}`;
    res.json({ url: shareUrl });
  } catch (err) {
    log(`Share generation error: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

// Guest share – stores messages in guest_shares table (new)
app.post('/api/share/guest', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages to share' });
    }
    const token = crypto.randomBytes(16).toString('hex');
    // Insert into guest_shares table
    const { data, error } = await supabase
      .from('guest_shares')
      .insert({ token, messages })
      .select()
      .single();
    if (error) throw error;
    const shareUrl = `${process.env.FRONTEND_URL}/share/${token}`;
    res.json({ url: shareUrl });
  } catch (err) {
    log(`Guest share error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to generate share link. Please ensure the guest_shares table exists (see migration instructions).' });
  }
});

// Public share view – works for both authenticated and guest shares
app.get('/api/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    // First try shared_links (authenticated)
    let { data, error } = await supabase
      .from('shared_links')
      .select('conversation_id')
      .eq('token', token)
      .single();
    if (data && data.conversation_id) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', data.conversation_id)
        .order('created_at', { ascending: true });
      return res.json({ messages: msgs || [] });
    }
    // Fallback: try guest_shares
    const { data: guestData, error: guestError } = await supabase
      .from('guest_shares')
      .select('messages')
      .eq('token', token)
      .single();
    if (guestError || !guestData) {
      return res.status(404).json({ error: 'Share not found' });
    }
    res.json({ messages: guestData.messages });
  } catch (err) {
    log(`Share view error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Error retrieving shared messages' });
  }
});

// ======================== FRONTEND ========================
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.listen(PORT, () => {
  log(`🚀 AgriDeepAI server running on port ${PORT}`, 'info');
  log(`🧠 Using Groq with dynamic chat model discovery`, 'info');
});
