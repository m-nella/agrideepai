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
const Groq = require('groq-sdk');

// ---------- Brevo Email ----------
const brevo = require('@getbrevo/brevo');
const defaultClient = brevo.ApiClient.instance;
const apiKeyAuth = defaultClient.authentications['api-key'];
if (apiKeyAuth) apiKeyAuth.apiKey = process.env.BREVO_API_KEY || '';
const brevoApi = new brevo.TransactionalEmailsApi();

const log = (msg, type = 'info') => console.log(`[${new Date().toISOString()}] [${type.toUpperCase()}] ${msg}`);

const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  message: 'Too many requests, please try again later.',
  standardHeaders: true, legacyHeaders: false,
});
app.use('/api/', limiter);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

// ============ AI PROVIDERS ============
// --- Groq (PRIMARY) — Models updated Sep 2026 ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// Current Groq models (verified working Sep 2026)
const GROQ_TEXT_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3-32b',
  'deepseek-r1-distill-llama-70b',
];
const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
];

// --- OpenRouter (FALLBACK) ---
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Current OpenRouter free models (verified Sep 2026)
const OPENROUTER_TEXT_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'mistralai/mistral-7b-instruct:free',
  'google/gemma-3-27b-it:free',
  'deepseek/deepseek-r1:free',
  'z-ai/glm-5.2:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];
const OPENROUTER_VISION_MODELS = [
  'minimax/minimax-m3:free',
  'thinkingmachines/inkling:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

const openRouterCooldown = {};
function markCooldown(model, seconds = 120) { openRouterCooldown[model] = Date.now() + seconds * 1000; }
function isCoolingDown(model) { return openRouterCooldown[model] && Date.now() < openRouterCooldown[model]; }

// ---------- AI Streaming ----------
async function getAIStream(chatMessages, imageData = null) {
  const errors = [];

  // 1) Groq
  if (groq) {
    const models = imageData ? GROQ_VISION_MODELS : GROQ_TEXT_MODELS;
    for (const model of models) {
      try {
        const stream = await groq.chat.completions.create({
          model,
          messages: chatMessages,
          temperature: 0.6,
          max_tokens: 900,
          stream: true,
        });
        log(`✅ Using Groq model: ${model}${imageData ? ' (vision)' : ''}`, 'info');
        return { stream, provider: 'groq', model };
      } catch (err) {
        const msg = err.message || String(err);
        log(`⚠️ Groq ${model} failed: ${msg}`, 'warn');
        errors.push(`groq:${model}=${msg.slice(0, 80)}`);
      }
    }
  } else {
    log('Groq not configured (no GROQ_API_KEY)', 'warn');
  }

  // 2) OpenRouter
  if (OPENROUTER_API_KEY) {
    const models = imageData ? OPENROUTER_VISION_MODELS : OPENROUTER_TEXT_MODELS;
    for (const model of models) {
      if (isCoolingDown(model)) continue;
      try {
        let finalMessages = chatMessages;
        if (imageData) {
          finalMessages = chatMessages.map((m, i) => {
            if (i === chatMessages.length - 1 && m.role === 'user') {
              const parts = [];
              if (m.content) parts.push({ type: 'text', text: m.content });
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${imageData.mimeType};base64,${imageData.base64}` },
              });
              return { role: 'user', content: parts };
            }
            return m;
          });
        }
        const response = await axios.post(OPENROUTER_URL, {
          model,
          messages: finalMessages,
          temperature: 0.6,
          max_tokens: 900,
          stream: true,
        }, {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.FRONTEND_URL || 'https://agrideepai.agentdomains.co',
            'X-Title': 'AgriDeepAI',
          },
          responseType: 'stream',
          timeout: 60000,
        });
        log(`✅ Using OpenRouter model: ${model}${imageData ? ' (vision)' : ''}`, 'info');
        return { stream: response.data, provider: 'openrouter', model };
      } catch (err) {
        const status = err.response?.status;
        const msg = err.message || String(err);
        log(`⚠️ OpenRouter ${model} failed: ${status || ''} ${msg}`, 'warn');
        errors.push(`openrouter:${model}=${status || msg}`);
        if (status === 429) markCooldown(model, 120);
        if (status === 404 || status === 400) markCooldown(model, 300);
      }
    }
  } else {
    log('OpenRouter not configured (no OPENROUTER_API_KEY)', 'warn');
  }

  throw new Error(`All AI providers failed. Last: ${errors.slice(-2).join(' | ')}`);
}

function consumeGroqStream(stream, res, onDone) {
  let full = '';
  (async () => {
    try {
      for await (const chunk of stream) {
        const text = chunk.choices?.[0]?.delta?.content || '';
        if (text) {
          full += text;
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      if (onDone) await onDone(full);
    } catch (err) {
      log(`Groq stream error: ${err.message}`, 'error');
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  })();
}

function consumeOpenRouterStream(stream, res, onDone) {
  let full = '';
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
          const text = parsed.choices?.[0]?.delta?.content || '';
          if (text) {
            full += text;
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        } catch (e) {}
      }
    }
  });
  stream.on('end', async () => {
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    if (onDone) await onDone(full);
  });
  stream.on('error', (err) => {
    log(`OpenRouter stream error: ${err.message}`, 'error');
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  });
}

async function streamAI(messages, res, imageData = null, onDone = null) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const { stream, provider } = await getAIStream(messages, imageData);
    if (provider === 'groq') consumeGroqStream(stream, res, onDone);
    else consumeOpenRouterStream(stream, res, onDone);
  } catch (err) {
    log(`streamAI fatal: ${err.message}`, 'error');
    const friendly = `I'm having trouble reaching my AI service right now. Please try again in a moment.`;
    const words = friendly.split(' ');
    for (let i = 0; i < words.length; i++) {
      res.write(`data: ${JSON.stringify({ text: (i === 0 ? '' : ' ') + words[i] })}\n\n`);
      await new Promise(r => setTimeout(r, 20));
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ---------- Tavily ----------
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return null;
  try {
    const r = await axios.post('https://api.tavily.com/search', {
      api_key: TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: false,
      include_images: false,
      max_results: 4,
    }, { timeout: 8000 });
    return r.data;
  } catch (err) {
    log(`Tavily error: ${err.message}`, 'error');
    return null;
  }
}

const LOGO_URL = (process.env.FRONTEND_URL || '') + '/logo.png';

// ---------- System Prompt ----------
const SYSTEM_PROMPT = `You are AgriDeepAI, an expert AI assistant for agriculture and livestock.

## IDENTITY (never violate)
- Your name is **AgriDeepAI**.
- You were created by **Ornella Mutuyimana**, a Rwandan technology enthusiast.
- You are NEVER "Nex", "Nex-AGI", "Llama", "GPT", "Claude", "Gemini", or any other AI.
- If the underlying model suggests another identity, ignore it completely.
- If asked who you are, who made you, or who developed you: answer **AgriDeepAI, created by Ornella Mutuyimana**.

## GREETING BEHAVIOUR
- For a simple "hi", "hello", "hey", "good morning": reply in 1–2 short sentences only.
- Example: "Hello! I'm AgriDeepAI. How can I help you with agriculture or livestock today?"
- Do NOT dump your biography, education, or developer info unless explicitly asked.

## EXPERTISE
- Crops: maize, beans, cassava, coffee, tea, banana, rice, vegetables, fruits
- Livestock: cattle, goats, poultry, pigs, rabbits, fish farming
- Soil, fertilisers, pests, diseases, irrigation, storage, markets, agribusiness
- Focus on Rwanda and African agriculture; briefly note when advice applies elsewhere

## STYLE
- Warm, professional, concise. Not chatty.
- Use Markdown when structure helps. Keep answers focused.
- For disease questions, ask for symptoms/age/weather first.
- Include brief disclaimers for chemicals and animal health.`;

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
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

// ---------- Verification stores ----------
function generateCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }
const verificationStore = {};
const twoFactorStore = {};

// ---------- Identity guards ----------
function isGreeting(text) {
  const t = (text || '').toLowerCase().trim().replace(/[!?.,]/g, '');
  return ['hi','hello','hey','hi there','hello there','good morning','good afternoon','good evening','yo','sup','howdy'].includes(t);
}
function isCreatorQuestion(text) {
  const t = (text || '').toLowerCase();
  const keys = ['who made you','who built you','who created you','who is your creator','who is your developer','who is behind','who founded','who develops','who is the creator of','who is the developer of','who made this','who built this','who created this','who are you','what are you','who is your maker','who is your owner','who owns you'];
  return keys.some(k => t.includes(k));
}
async function streamSimpleText(res, text) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    res.write(`data: ${JSON.stringify({ text: (i === 0 ? '' : ' ') + words[i] })}\n\n`);
    await new Promise(r => setTimeout(r, 20));
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
async function tryIdentityShortcut(messages, res) {
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last) return false;
  if (isCreatorQuestion(last.content)) {
    await streamSimpleText(res, `I'm **AgriDeepAI**, created by **Ornella Mutuyimana**, a Rwandan technology enthusiast. How can I help you today?`);
    return true;
  }
  if (isGreeting(last.content)) {
    await streamSimpleText(res, `Hello! I'm **AgriDeepAI**. How can I help you with agriculture or livestock today?`);
    return true;
  }
  return false;
}

// ---------- Email ----------
async function sendVerificationEmail(email, code, action = 'verify', extra = '') {
  try {
    const expiration = '10 minutes';
    const actionMap = {
      'verify': 'Verify your account','change-email': 'Change your email',
      'change-password': 'Change your password','delete-account': 'Delete your account',
      'signup': 'Complete your registration',
    };
    const subject = actionMap[action] || 'Verification code';
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${subject}</title>
      <style>body{font-family:Arial,sans-serif;background:#f4f4f4;padding:20px}
      .container{max-width:560px;margin:0 auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.1)}
      .logo{text-align:center;margin-bottom:20px}.logo img{height:60px}
      h1{color:#1e232a;font-size:24px;margin:0 0 8px}p{color:#555;font-size:16px;line-height:1.6}
      .code{font-size:28px;font-weight:bold;color:#2f8f46;background:#f0f8f0;padding:10px 20px;border-radius:8px;display:inline-block;letter-spacing:4px;margin:10px 0}
      .footer{margin-top:30px;font-size:13px;color:#888;border-top:1px solid #eee;padding-top:20px;text-align:center}</style>
      </head><body><div class="container">
      <div class="logo"><img src="${LOGO_URL}" alt="AgriDeepAI" /></div>
      <h1>${subject}</h1><p>${extra} Use the code below to continue.</p>
      <div style="text-align:center"><span class="code">${code}</span></div>
      <p><strong>This code is valid for ${expiration}.</strong> If you didn't request this, ignore this email.</p>
      <div class="footer">&copy; 2026 AgriDeepAI. All rights reserved.</div>
      </div></body></html>`;
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

// ============ AUTH ROUTES ============
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password))
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    if (existingUsers.users.some(u => u.email === email))
      return res.status(400).json({ error: 'Email already registered. Please sign in.' });
    const code = generateCode();
    verificationStore[email] = { code, expires: Date.now() + 10 * 60 * 1000, action: 'signup',
      data: { email, password, fullName: fullName || email.split('@')[0] } };
    await sendVerificationEmail(email, code, 'signup', 'To complete your registration, use the code below.');
    res.status(200).json({ message: 'Verification code sent to your email.', email });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/auth/confirm-signup', async (req, res) => {
  try {
    const { email, code } = req.body;
    const stored = verificationStore[email];
    if (!stored || stored.action !== 'signup') return res.status(400).json({ error: 'No pending registration found.' });
    if (stored.code !== code || Date.now() > stored.expires) return res.status(400).json({ error: 'Invalid or expired code.' });
    const { email: userEmail, password, fullName } = stored.data;
    const { data, error } = await supabase.auth.signUp({ email: userEmail, password,
      options: { data: { full_name: fullName }, email_confirm: true } });
    if (error) throw error;
    const user = data.user;
    if (!user) throw new Error('User creation failed');
    await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    await supabase.from('profiles').insert({ id: user.id, full_name: fullName });
    delete verificationStore[email];
    const { data: sd, error: se } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    if (se) throw se;
    res.status(201).json({ user: sd.user, session: sd.session });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const stored = verificationStore[email];
    if (!stored || stored.action !== 'signup') return res.status(400).json({ error: 'No pending registration found.' });
    const code = generateCode();
    stored.code = code; stored.expires = Date.now() + 10 * 60 * 1000;
    await sendVerificationEmail(email, code, 'signup', 'Resend: complete your registration.');
    res.json({ message: 'New code sent.' });
  } catch (err) { res.status(500).json({ error: 'Failed to resend code.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: profile } = await supabase.from('profiles').select('two_factor_enabled').eq('id', data.user.id).single();
    if (profile?.two_factor_enabled) {
      const tempToken = crypto.randomBytes(32).toString('hex');
      twoFactorStore[tempToken] = { userId: data.user.id, expires: Date.now() + 10 * 60 * 1000 };
      return res.json({ requires2fa: true, tempToken, message: '2FA required' });
    }
    res.json({ user: data.user, session: data.session });
  } catch (err) { res.status(401).json({ error: err.message }); }
});

app.post('/api/auth/2fa/validate-login', async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    const entry = twoFactorStore[tempToken];
    if (!entry || Date.now() > entry.expires) return res.status(400).json({ error: 'Invalid or expired token' });
    const { data: profile } = await supabase.from('profiles').select('two_factor_secret').eq('id', entry.userId).single();
    if (!profile?.two_factor_secret) return res.status(400).json({ error: '2FA not set up for this user' });
    const verified = speakeasy.totp.verify({ secret: profile.two_factor_secret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(400).json({ error: 'Invalid 2FA code' });
    delete twoFactorStore[tempToken];
    const { data: sd, error: se } = await supabase.auth.admin.createSession({ user_id: entry.userId });
    if (se) throw se;
    const { data: ud } = await supabase.auth.admin.getUserById(entry.userId);
    res.json({ user: ud.user, session: sd });
  } catch (err) { res.status(500).json({ error: 'Failed to validate 2FA' }); }
});

app.post('/api/auth/send-verification-code', authenticate, async (req, res) => {
  try {
    const { action } = req.body;
    const user = req.user;
    const code = generateCode();
    verificationStore[`${user.id}_${action}`] = { code, expires: Date.now() + 10 * 60 * 1000, action, verified: false };
    await sendVerificationEmail(user.email, code, action);
    res.json({ message: 'Verification code sent.' });
  } catch (err) { res.status(500).json({ error: 'Failed to send code.' }); }
});

app.post('/api/auth/verify-code', authenticate, async (req, res) => {
  try {
    const { code, action } = req.body;
    const key = `${req.user.id}_${action}`;
    const stored = verificationStore[key];
    if (!stored || stored.code !== code || Date.now() > stored.expires) return res.status(400).json({ error: 'Invalid or expired code' });
    stored.verified = true;
    res.json({ message: 'Code verified.' });
  } catch (err) { res.status(500).json({ error: 'Verification failed.' }); }
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const key = `${req.user.id}_change-password`;
    const stored = verificationStore[key];
    if (!stored?.verified) return res.status(400).json({ error: 'Please verify your code first.' });
    const { error: si } = await supabase.auth.signInWithPassword({ email: req.user.email, password: currentPassword });
    if (si) return res.status(401).json({ error: 'Current password incorrect' });
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword))
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
    await supabase.auth.updateUser({ password: newPassword });
    delete verificationStore[key];
    res.json({ message: 'Password changed successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/change-email', authenticate, async (req, res) => {
  try {
    const { newEmail } = req.body;
    const key = `${req.user.id}_change-email`;
    const stored = verificationStore[key];
    if (!stored?.verified) return res.status(400).json({ error: 'Please verify your code first.' });
    await supabase.auth.updateUser({ email: newEmail });
    delete verificationStore[key];
    res.json({ message: 'Email change requested. Please verify the new email.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/auth/delete-account', authenticate, async (req, res) => {
  try {
    const key = `${req.user.id}_delete-account`;
    const stored = verificationStore[key];
    if (!stored?.verified) return res.status(400).json({ error: 'Please verify your code first.' });
    await supabase.auth.admin.deleteUser(req.user.id);
    delete verificationStore[key];
    res.json({ message: 'Account deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/2fa/enable', authenticate, async (req, res) => {
  try {
    const { data: profile } = await supabase.from('profiles').select('two_factor_enabled').eq('id', req.user.id).single();
    if (profile?.two_factor_enabled) return res.status(400).json({ error: '2FA already enabled' });
    const secret = speakeasy.generateSecret({ length: 20, name: 'AgriDeepAI' });
    await supabase.from('profiles').update({ two_factor_secret: secret.base32 }).eq('id', req.user.id);
    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCodeDataUrl });
  } catch (err) { res.status(500).json({ error: 'Failed to enable 2FA' }); }
});

app.post('/api/auth/2fa/verify', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const { data: profile } = await supabase.from('profiles').select('two_factor_secret').eq('id', req.user.id).single();
    if (!profile?.two_factor_secret) return res.status(400).json({ error: '2FA not initialized.' });
    const verified = speakeasy.totp.verify({ secret: profile.two_factor_secret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(400).json({ error: 'Invalid code' });
    await supabase.from('profiles').update({ two_factor_enabled: true }).eq('id', req.user.id);
    res.json({ message: '2FA enabled successfully' });
  } catch (err) { res.status(500).json({ error: 'Failed to verify 2FA' }); }
});

app.post('/api/auth/2fa/disable', authenticate, async (req, res) => {
  try {
    await supabase.from('profiles').update({ two_factor_enabled: false, two_factor_secret: null }).eq('id', req.user.id);
    res.json({ message: '2FA disabled successfully' });
  } catch (err) { res.status(500).json({ error: 'Failed to disable 2FA' }); }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
    res.json({ user: req.user, profile });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/config', (req, res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
}));

// ============ CHAT HELPERS ============
function buildChatMessages(messages, systemPrompt = SYSTEM_PROMPT) {
  const history = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content || '') }));
  return [{ role: 'system', content: systemPrompt }, ...history];
}

async function enrichWithWebSearch(query) {
  if (!TAVILY_API_KEY) return query;
  const sr = await tavilySearch(query);
  if (sr?.answer) return `${query}\n\n[Current web information, use if relevant]\n${sr.answer}`;
  return query;
}

// ============ GUEST CHAT ============
app.post('/api/chat/guest', async (req, res) => {
  try {
    const { messages, image } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Messages required' });

    if (await tryIdentityShortcut(messages, res)) return;

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const enrichedPrompt = await enrichWithWebSearch(lastUser.content);
    const withoutLast = messages.slice(0, messages.lastIndexOf(lastUser));
    const chatMessages = buildChatMessages([...withoutLast, { role: 'user', content: enrichedPrompt }]);
    const imageData = image ? { base64: image.base64, mimeType: image.mimeType } : null;

    await streamAI(chatMessages, res, imageData);
  } catch (err) {
    log(`Guest chat error: ${err.message}`, 'error');
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
});

// ============ AUTHENTICATED CHAT ============
app.get('/api/chat/conversations', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.from('conversations').select('*')
      .eq('user_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/conversations', authenticate, async (req, res) => {
  try {
    const { title } = req.body;
    const { data, error } = await supabase.from('conversations')
      .insert({ user_id: req.user.id, title: title || 'New Chat' }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, pinned, archived } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (pinned !== undefined) updates.pinned = pinned;
    if (archived !== undefined) updates.archived = archived;
    const { data, error } = await supabase.from('conversations')
      .update(updates).eq('id', id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('conversations').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/chat/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.from('messages').select('*')
      .eq('conversation_id', req.params.id).order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/conversations/:id/messages', authenticate, upload.single('file'), async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { message } = req.body;
    const file = req.file;

    const { data: conv } = await supabase.from('conversations').select('id')
      .eq('id', conversationId).eq('user_id', req.user.id).single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    if (message && (isCreatorQuestion(message) || isGreeting(message))) {
      await supabase.from('messages').insert({ conversation_id: conversationId, role: 'user', content: message });
      const reply = isCreatorQuestion(message)
        ? `I'm **AgriDeepAI**, created by **Ornella Mutuyimana**, a Rwandan technology enthusiast. How can I help you today?`
        : `Hello! I'm **AgriDeepAI**. How can I help you with agriculture or livestock today?`;
      await supabase.from('messages').insert({
        conversation_id: conversationId, role: 'assistant', content: reply,
        versions: [reply], current_version_index: 0,
      });
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
      return streamSimpleText(res, reply);
    }

    let fileMetadata = null;
    let imageData = null;
    if (file) {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${req.user.id}/${fileName}`;
      await supabase.storage.from(storageBucket).upload(filePath, file.buffer, { contentType: file.mimetype });
      const { data: pu } = supabase.storage.from(storageBucket).getPublicUrl(filePath);
      fileMetadata = {
        filename: file.originalname, storage_path: filePath, mime_type: file.mimetype,
        size: file.size, public_url: pu.publicUrl,
      };
      await supabase.from('files').insert({
        user_id: req.user.id, filename: file.originalname, storage_path: filePath,
        mime_type: file.mimetype, size: file.size,
      });
      if (file.mimetype.startsWith('image/')) {
        imageData = { base64: file.buffer.toString('base64'), mimeType: file.mimetype };
      }
    }

    const messageData = { conversation_id: conversationId, role: 'user', content: message || '' };
    if (fileMetadata) messageData.files = [fileMetadata];
    await supabase.from('messages').insert(messageData);

    const { data: history } = await supabase.from('messages').select('*')
      .eq('conversation_id', conversationId).order('created_at', { ascending: true });
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    const enrichedPrompt = await enrichWithWebSearch(message || 'agriculture update');
    const withoutLast = aiMessages.slice(0, -1);
    const chatMessages = buildChatMessages([...withoutLast, { role: 'user', content: enrichedPrompt }]);

    await streamAI(chatMessages, res, imageData, async (full) => {
      await supabase.from('messages').insert({
        conversation_id: conversationId, role: 'assistant', content: full,
        versions: [full], current_version_index: 0,
      });
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
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
    const { data: all } = await supabase.from('messages').select('*')
      .eq('conversation_id', conversationId).order('created_at', { ascending: true });
    if (messageIndex >= all.length || all[messageIndex].role !== 'assistant')
      return res.status(400).json({ error: 'Invalid index' });
    const idsToDelete = all.slice(messageIndex).map(m => m.id);
    if (idsToDelete.length) await supabase.from('messages').delete().in('id', idsToDelete);
    const { data: remaining } = await supabase.from('messages').select('*')
      .eq('conversation_id', conversationId).order('created_at', { ascending: true });
    if (!remaining.length || remaining[remaining.length - 1].role !== 'user')
      return res.status(400).json({ error: 'No user message' });
    const chatMessages = buildChatMessages(remaining);
    await streamAI(chatMessages, res, null, async (full) => {
      await supabase.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: full });
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
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
    const { data: msg } = await supabase.from('messages')
      .select('*, conversation_id, conversations(user_id)').eq('id', id).single();
    if (!msg || msg.conversations.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    if (msg.role !== 'user') return res.status(400).json({ error: 'Only user messages can be edited' });
    await supabase.from('messages').update({ content }).eq('id', id);
    if (truncate) {
      const { data: later } = await supabase.from('messages').select('id')
        .eq('conversation_id', msg.conversation_id).gt('created_at', msg.created_at);
      if (later.length) await supabase.from('messages').delete().in('id', later.map(m => m.id));
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', msg.conversation_id);
    }
    res.json({ message: 'Updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ SHARE ============
app.post('/api/chat/share/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: conv } = await supabase.from('conversations').select('id')
      .eq('id', id).eq('user_id', req.user.id).single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    const token = crypto.randomBytes(16).toString('hex');
    const { error } = await supabase.from('shared_links').insert({ conversation_id: id, token }).select().single();
    if (error) throw error;
    res.json({ url: `${process.env.FRONTEND_URL}/share/${token}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/share/guest', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'No messages to share' });
    const token = crypto.randomBytes(16).toString('hex');
    const { error } = await supabase.from('guest_shares').insert({ token, messages }).select().single();
    if (error) throw error;
    res.json({ url: `${process.env.FRONTEND_URL}/share/${token}` });
  } catch (err) {
    log(`Guest share error: ${err.message}`, 'error');
    res.status(500).json({ error: 'Failed to generate share link.' });
  }
});

app.get('/api/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    let { data } = await supabase.from('shared_links').select('conversation_id').eq('token', token).single();
    if (data?.conversation_id) {
      const { data: msgs } = await supabase.from('messages').select('*')
        .eq('conversation_id', data.conversation_id).order('created_at', { ascending: true });
      return res.json({ messages: msgs || [] });
    }
    const { data: guestData, error: ge } = await supabase.from('guest_shares').select('messages').eq('token', token).single();
    if (ge || !guestData) return res.status(404).json({ error: 'Share not found' });
    res.json({ messages: guestData.messages });
  } catch (err) { res.status(500).json({ error: 'Error retrieving shared messages' }); }
});

// ============ FRONTEND ============
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.listen(PORT, () => {
  log(`🚀 AgriDeepAI running on port ${PORT}`, 'info');
  log(`Primary: ${GROQ_API_KEY ? 'Groq' : 'none'} | Fallback: ${OPENROUTER_API_KEY ? 'OpenRouter' : 'none'}`, 'info');
});
