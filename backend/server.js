require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

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

// ---------- OpenRouter ----------
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MODEL_CANDIDATES = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'liquid/lfm-2.5-2.6b:free',
];

let workingModel = null;
let modelDiscoveryDone = false;

async function discoverModels() {
  if (modelDiscoveryDone) return;
  try {
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }
    });
    const allModels = response.data.data || [];
    const freeModels = allModels
      .filter(m => m.id && m.id.includes(':free'))
      .map(m => m.id);
    if (freeModels.length > 0) {
      // Prepend discovered free models to the candidate list
      for (const model of freeModels) {
        if (!MODEL_CANDIDATES.includes(model)) {
          MODEL_CANDIDATES.unshift(model);
        }
      }
      log(`Discovered ${freeModels.length} free models`, 'info');
    }
    modelDiscoveryDone = true;
  } catch (err) {
    log(`Model discovery failed: ${err.message}`, 'error');
  }
}

async function getWorkingModel() {
  if (workingModel) return workingModel;
  await discoverModels();

  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await axios.post(
        OPENROUTER_URL,
        {
          model: model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.FRONTEND_URL,
            'X-Title': 'AgriDeepAI',
          },
          timeout: 5000,
        }
      );
      if (response.data?.choices?.length > 0) {
        workingModel = model;
        log(`✅ Using OpenRouter model: ${model}`, 'info');
        return model;
      }
    } catch (err) {
      log(`⚠️ Model ${model} failed: ${err.message}`, 'warn');
    }
  }
  throw new Error('No working models available. Check your OpenRouter API key.');
}

async function callOpenRouter(messages, stream = true) {
  const model = await getWorkingModel();
  const response = await axios.post(
    OPENROUTER_URL,
    {
      model,
      messages,
      temperature: 0.7,
      max_tokens: 512,
      stream,
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL,
        'X-Title': 'AgriDeepAI',
      },
      responseType: stream ? 'stream' : 'json',
      timeout: 30000,
    }
  );
  return response;
}

// ---------- Tavily ----------
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ---------- Logo URL ----------
const LOGO_URL = process.env.FRONTEND_URL + '/logo.png';

// ---------- System Prompt (shortened, professional) ----------
const SYSTEM_PROMPT = `
You are AgriDeepAI, a professional AI assistant for agriculture, livestock, crop farming, animal farming, plant health, soil management, and agribusiness. Provide practical, accurate, actionable advice, with focus on Rwanda and African agriculture.

**BEHAVIOR:**
- Be warm, professional, and conversational.
- For crop/livestock disease questions, ask for details (symptoms, age, weather, etc.) before giving advice.
- Always include disclaimers for health, safety, or chemical use.

**RESPONSE FORMATTING:**
- Use Markdown formatting: headings, bullet points, numbered lists, tables for comparisons.
- Keep responses concise and relevant. For simple questions like "What is your name?" respond briefly with your name and offer assistance.

**CREATOR IDENTITY:**
AgriDeepAI was created by **Ornella Mutuyimana**, a Rwandan technology enthusiast. When asked about your creator, give a short, friendly answer and offer further help.
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

// ---------- Verification store ----------
function generateCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }
const verificationStore = {};

// ======================== EMAIL HELPER ========================

async function sendVerificationEmail(email, code, action = 'verify', extra = '') {
  try {
    const logoUrl = LOGO_URL;
    const expiration = '10 minutes';
    const actionMap = {
      'verify': 'Verify your account',
      'change-email': 'Change your email',
      'change-password': 'Change your password',
      'delete-account': 'Delete your account',
      'signup': 'Complete your registration'
    };
    const subject = actionMap[action] || 'Verification code';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>${subject}</title>
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
          <h1>${subject}</h1>
          <p>${extra} Use the code below to continue.</p>
          <div style="text-align: center;"><span class="code">${code}</span></div>
          <p><strong>This code is valid for ${expiration}.</strong> If you didn't request this, ignore this email.</p>
          <div class="footer">&copy; 2026 AgriDeepAI. All rights reserved.</div>
        </div>
      </body>
      </html>
    `;

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = { name: 'AgriDeepAI', email: 'noreply@agrideepai.agentdomains.co' };
    sendSmtpEmail.to = [{ email }];
    await brevoApi.sendTransacEmail(sendSmtpEmail);
    log(`Verification email sent to ${email} (${action})`, 'info');
  } catch (err) {
    log(`Email send error: ${err.message}`, 'error');
    throw err;
  }
}

// ======================== AUTH ROUTES ========================

app.post('/api/auth/signup', async (req, res) => {
  log('Signup intent', 'info');
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
    }
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const exists = existingUsers.users.some(u => u.email === email);
    if (exists) {
      return res.status(400).json({ error: 'Email already registered. Please sign in.' });
    }
    const code = generateCode();
    verificationStore[email] = {
      code,
      expires: Date.now() + 10 * 60 * 1000,
      action: 'signup',
      data: { email, password, fullName: fullName || email.split('@')[0] }
    };
    await sendVerificationEmail(email, code, 'signup', 'To complete your registration, use the code below.');
    res.status(200).json({ message: 'Verification code sent to your email.', email });
  } catch (err) {
    log(`Signup intent error: ${err.message}`, 'error');
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/confirm-signup', async (req, res) => {
  log('Confirm signup', 'info');
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
    const stored = verificationStore[email];
    if (!stored || stored.action !== 'signup' || stored.code !== code || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }
    const { email: userEmail, password, fullName } = stored.data;
    const { data, error } = await supabase.auth.signUp({
      email: userEmail,
      password,
      options: {
        data: { full_name: fullName },
        email_confirm: true,
      }
    });
    if (error) throw error;
    const user = data.user;
    if (!user) throw new Error('User creation failed');
    await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    await supabase.from('profiles').insert({ id: user.id, full_name: fullName });
    delete verificationStore[email];
    const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password
    });
    if (signInError) throw signInError;
    log(`User ${userEmail} created and verified`, 'info');
    res.status(201).json({ user: sessionData.user, session: sessionData.session });
  } catch (err) {
    log(`Confirm signup error: ${err.message}`, 'error');
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  log('Resend verification', 'info');
  try {
    const { email } = req.body;
    const stored = verificationStore[email];
    if (!stored || stored.action !== 'signup') return res.status(400).json({ error: 'No pending registration found.' });
    const code = generateCode();
    stored.code = code;
    stored.expires = Date.now() + 10 * 60 * 1000;
    await sendVerificationEmail(email, code, 'signup', 'Resend: complete your registration.');
    res.json({ message: 'New code sent.' });
  } catch (err) {
    log(`Resend error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to resend code.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  log('Login attempt', 'info');
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('two_factor_enabled')
      .eq('id', data.user.id)
      .single();
    if (profileError) throw profileError;
    if (profile && profile.two_factor_enabled) {
      const tempToken = crypto.randomBytes(32).toString('hex');
      const twoFactorStore = global.twoFactorStore || {};
      twoFactorStore[tempToken] = { userId: data.user.id, expires: Date.now() + 10 * 60 * 1000 };
      global.twoFactorStore = twoFactorStore;
      return res.json({ requires2fa: true, tempToken, message: '2FA required' });
    }
    log(`User ${email} logged in (no 2FA)`, 'info');
    res.json({ user: data.user, session: data.session });
  } catch (err) {
    log(`Login error: ${err.message}`, 'warn');
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/auth/2fa/validate-login', async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ error: 'Missing token or code' });
    const store = global.twoFactorStore || {};
    const entry = store[tempToken];
    if (!entry || Date.now() > entry.expires) return res.status(400).json({ error: 'Invalid or expired token' });
    const { data: profile } = await supabase
      .from('profiles')
      .select('two_factor_secret')
      .eq('id', entry.userId)
      .single();
    if (!profile || !profile.two_factor_secret) return res.status(400).json({ error: '2FA not set up for this user' });
    const verified = speakeasy.totp.verify({
      secret: profile.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });
    if (!verified) return res.status(400).json({ error: 'Invalid 2FA code' });
    delete store[tempToken];
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.createSession({
      user_id: entry.userId
    });
    if (sessionError) throw sessionError;
    const { data: userData } = await supabase.auth.admin.getUserById(entry.userId);
    log(`User ${userData.user.email} logged in with 2FA`, 'info');
    res.json({ user: userData.user, session: sessionData });
  } catch (err) {
    log(`2FA login validation error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to validate 2FA' });
  }
});

app.post('/api/auth/send-verification-code', authenticate, async (req, res) => {
  try {
    const { action } = req.body;
    const user = req.user;
    const code = generateCode();
    const key = `${user.id}_${action}`;
    verificationStore[key] = { code, expires: Date.now() + 10 * 60 * 1000, action, verified: false };
    await sendVerificationEmail(user.email, code, action);
    res.json({ message: 'Verification code sent.' });
  } catch (err) {
    log(`Send code error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to send code.' });
  }
});

app.post('/api/auth/verify-code', authenticate, async (req, res) => {
  try {
    const { code, action } = req.body;
    const key = `${req.user.id}_${action}`;
    const stored = verificationStore[key];
    if (!stored || stored.code !== code || Date.now() > stored.expires) return res.status(400).json({ error: 'Invalid or expired code' });
    stored.verified = true;
    res.json({ message: 'Code verified.' });
  } catch (err) {
    log(`Verify code error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Verification failed.' });
  }
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword, code } = req.body;
    const key = `${req.user.id}_change-password`;
    const stored = verificationStore[key];
    if (!stored || !stored.verified) return res.status(400).json({ error: 'Please verify your code first.' });
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: currentPassword
    });
    if (signInError) return res.status(401).json({ error: 'Current password incorrect' });
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
    }
    await supabase.auth.updateUser({ password: newPassword });
    delete verificationStore[key];
    log(`Password changed for ${req.user.email}`, 'info');
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/change-email', authenticate, async (req, res) => {
  try {
    const { newEmail, code } = req.body;
    const key = `${req.user.id}_change-email`;
    const stored = verificationStore[key];
    if (!stored || !stored.verified) return res.status(400).json({ error: 'Please verify your code first.' });
    await supabase.auth.updateUser({ email: newEmail });
    delete verificationStore[key];
    log(`Email change requested for ${req.user.email} -> ${newEmail}`, 'info');
    res.json({ message: 'Email change requested. Please verify the new email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/auth/delete-account', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const key = `${req.user.id}_delete-account`;
    const stored = verificationStore[key];
    if (!stored || !stored.verified) return res.status(400).json({ error: 'Please verify your code first.' });
    await supabase.auth.admin.deleteUser(req.user.id);
    delete verificationStore[key];
    log(`Account deleted for ${req.user.email}`, 'info');
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/2fa/enable', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('two_factor_enabled')
      .eq('id', user.id)
      .single();
    if (profile?.two_factor_enabled) return res.status(400).json({ error: '2FA already enabled' });
    const secret = speakeasy.generateSecret({ length: 20, name: 'AgriDeepAI' });
    await supabase.from('profiles').update({ two_factor_secret: secret.base32 }).eq('id', user.id);
    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCodeDataUrl });
  } catch (err) {
    log(`Enable 2FA error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

app.post('/api/auth/2fa/verify', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });
    const user = req.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('two_factor_secret')
      .eq('id', user.id)
      .single();
    if (!profile?.two_factor_secret) return res.status(400).json({ error: '2FA not initialized. Enable first.' });
    const verified = speakeasy.totp.verify({
      secret: profile.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });
    if (!verified) return res.status(400).json({ error: 'Invalid code' });
    await supabase.from('profiles').update({ two_factor_enabled: true }).eq('id', user.id);
    log(`2FA enabled for ${user.email}`, 'info');
    res.json({ message: '2FA enabled successfully' });
  } catch (err) {
    log(`Verify 2FA error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to verify 2FA' });
  }
});

app.post('/api/auth/2fa/disable', authenticate, async (req, res) => {
  try {
    const user = req.user;
    await supabase.from('profiles').update({ two_factor_enabled: false, two_factor_secret: null }).eq('id', user.id);
    log(`2FA disabled for ${user.email}`, 'info');
    res.json({ message: '2FA disabled successfully' });
  } catch (err) {
    log(`Disable 2FA error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to disable 2FA' });
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

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// ======================== CHAT ROUTES ========================

app.post('/api/chat/guest', async (req, res) => {
  log('Guest chat request', 'debug');
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }

    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      const question = lastUserMsg.content.toLowerCase();
      const creatorKeywords = ['who made you', 'who built you', 'who created you', 'who is your creator', 'who is your developer', 'who is behind', 'who founded', 'who develops', 'who is the creator of', 'who is the developer of', 'who made this', 'who built this', 'who created this'];
      if (creatorKeywords.some(keyword => question.includes(keyword))) {
        const creatorResponse = `
I was created by **Ornella Mutuyimana**, a Rwandan technology enthusiast passionate about using AI to help farmers and livestock keepers. How can I assist you today with agriculture or livestock?
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

    let searchResults = null;
    if (TAVILY_API_KEY && lastUserMsg) {
      searchResults = await tavilySearch(lastUserMsg.content);
    }

    let finalPrompt = messages[messages.length - 1].content;
    if (searchResults?.answer) {
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

    const response = await callOpenRouter(chatMessages, true);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';
    const stream = response.data;
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          } catch (e) {}
        }
      }
    });
    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      log('Guest chat completed', 'debug');
    });
    stream.on('error', (err) => {
      log(`Stream error: ${err.message}`, 'error');
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    });
  } catch (err) {
    log(`Guest chat error: ${err.message}`, 'error');
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
});

// Authenticated chat endpoints (identical to previous, but using callOpenRouter)
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

    if (message) {
      const question = message.toLowerCase();
      const creatorKeywords = ['who made you', 'who built you', 'who created you', 'who is your creator', 'who is your developer', 'who is behind', 'who founded', 'who develops', 'who is the creator of', 'who is the developer of', 'who made this', 'who built this', 'who created this'];
      if (creatorKeywords.some(keyword => question.includes(keyword))) {
        await supabase.from('messages').insert({ conversation_id: conversationId, role: 'user', content: message || '' });
        const creatorResponse = `
I was created by **Ornella Mutuyimana**, a Rwandan technology enthusiast passionate about using AI to help farmers and livestock keepers. How can I assist you today with agriculture or livestock?
        `.trim();
        await supabase.from('messages').insert({
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

    let fileMetadata = null;
    if (file) {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${req.user.id}/${fileName}`;
      await supabase.storage.from(storageBucket).upload(filePath, file.buffer, { contentType: file.mimetype });
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
    if (searchResults?.answer) {
      finalPrompt = `Current information (from web search):\n${searchResults.answer}\n\nNow answer:\n${finalPrompt}`;
    }

    const chatHistory = aiMessages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...chatHistory,
      { role: 'user', content: finalPrompt }
    ];

    const response = await callOpenRouter(chatMessages, true);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';
    const stream = response.data;
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          } catch (e) {}
        }
      }
    });
    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: fullResponse,
        versions: [fullResponse],
        current_version_index: 0,
      }).then(() => {
        supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
      });
    });
    stream.on('error', (err) => {
      log(`Stream error: ${err.message}`, 'error');
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    });
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
    const response = await callOpenRouter(chatMessages, true);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';
    const stream = response.data;
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          } catch (e) {}
        }
      }
    });
    stream.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
      supabase.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: fullResponse }).then(() => {
        supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
      });
    });
    stream.on('error', (err) => {
      log(`Stream error: ${err.message}`, 'error');
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    });
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
    if (!msg || msg.conversations.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    if (msg.role !== 'user') return res.status(400).json({ error: 'Only user messages can be edited' });
    await supabase.from('messages').update({ content }).eq('id', id);
    if (truncate) {
      const { data: later } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', msg.conversation_id)
        .gt('created_at', msg.created_at);
      if (later.length) await supabase.from('messages').delete().in('id', later.map(m => m.id));
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', msg.conversation_id);
    }
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== SHARE ROUTES ========================

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

app.post('/api/share/guest', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages to share' });
    }
    const token = crypto.randomBytes(16).toString('hex');
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
    res.status(500).json({ error: 'Failed to generate share link.' });
  }
});

app.get('/api/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    let { data, error } = await supabase
      .from('shared_links')
      .select('conversation_id')
      .eq('token', token)
      .single();
    if (data?.conversation_id) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', data.conversation_id)
        .order('created_at', { ascending: true });
      return res.json({ messages: msgs || [] });
    }
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
  log(`🧠 Using OpenRouter with fallback chain`, 'info');
});
