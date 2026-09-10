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
const pdfParse = require('pdf-parse');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');

const brevo = require('@getbrevo/brevo');
const defaultClient = brevo.ApiClient.instance;
const apiKeyAuth = defaultClient.authentications['api-key'];
if (apiKeyAuth) apiKeyAuth.apiKey = process.env.BREVO_API_KEY || '';
const brevoApi = new brevo.TransactionalEmailsApi();

const log = (msg, type = 'info') => console.log(`[${new Date().toISOString()}] [${type.toUpperCase()}] ${msg}`);

const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

const JWT_SECRET = process.env.JWT_SECRET || 'agrideepai-set-JWT_SECRET-in-env';
const signPending = (payload, ttl = 900) => jwt.sign(payload, JWT_SECRET, { expiresIn: ttl });
const verifyPending = (token) => { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } };

// Strip JWT reserved claims before re-signing a verified payload.
// jwt.sign() refuses to add a new `exp`/`iat` if the payload already has one.
function stripJwtClaims(p) {
  if (!p || typeof p !== 'object') return {};
  const { exp, iat, nbf, aud, iss, sub, jti, ...rest } = p;
  return rest;
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
const GROQ_TEXT_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 'groq/compound'];
const GROQ_VISION_MODELS = [];

const FHROUTER_API_KEY = process.env.FHROUTER_API_KEY;
const FHROUTER_URL = 'https://fhrouter.com/v1/chat/completions';
const FHROUTER_TEXT_MODELS = ['deepseek-v4-flash', 'glm-5.3-flash', 'grok-4.6'];
const FHROUTER_VISION_MODELS = [];

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TEXT_MODELS = ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-235b-a22b:free', 'mistralai/mistral-7b-instruct:free'];
const OPENROUTER_VISION_MODELS = [
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.2-11b-vision-instruct:free',
  'qwen/qwen-2-vl-7b-instruct:free',
  'google/gemma-3-27b-it:free',
];

const openRouterCooldown = {};
const markCooldown = (m, s = 120) => { openRouterCooldown[m] = Date.now() + s * 1000; };
const isCoolingDown = (m) => openRouterCooldown[m] && Date.now() < openRouterCooldown[m];

const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY;
async function ocrImage(buffer, filename, mimeType) {
  if (!OCR_SPACE_API_KEY) return null;
  try {
    const formData = new FormData();
    formData.append('file', buffer, { filename, contentType: mimeType });
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '2');
    const res = await axios.post('https://api.ocr.space/parse/image', formData, {
      headers: { ...formData.getHeaders(), apikey: OCR_SPACE_API_KEY },
      maxBodyLength: Infinity, timeout: 30000,
    });
    return (res.data?.ParsedResults?.[0]?.ParsedText || '').trim();
  } catch (err) { log(`OCR.space error: ${err.message}`, 'warn'); return null; }
}

app.get('/api/debug/groq-models', async (req, res) => {
  if (!groq) return res.json({ error: 'GROQ_API_KEY not set' });
  try {
    const models = await groq.models.list();
    const ids = (models.data || []).map(m => m.id).sort();
    res.json({ count: ids.length, models: ids });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function getAIStream(chatMessages, imageData = null, isVisionRetry = false) {
  const errors = [];
  const usingVision = !!imageData && !isVisionRetry;

  if (usingVision) {
    if (groq) {
      for (const model of GROQ_VISION_MODELS) {
        try {
          const stream = await groq.chat.completions.create({ model, messages: chatMessages, temperature: 0.6, max_tokens: 1500, stream: true });
          log(`✅ Using Groq vision: ${model}`, 'info');
          return { stream, provider: 'groq', model };
        } catch (err) { errors.push(`groq:${model}`); }
      }
    }
    if (FHROUTER_API_KEY) {
      for (const model of FHROUTER_VISION_MODELS) {
        const cdKey = `fhrouter-v:${model}`;
        if (isCoolingDown(cdKey)) continue;
        try {
          const response = await axios.post(FHROUTER_URL, {
            model, messages: chatMessages, temperature: 0.6, max_tokens: 1500, stream: true,
          }, {
            headers: { 'Authorization': `Bearer ${FHROUTER_API_KEY}`, 'Content-Type': 'application/json' },
            responseType: 'stream', timeout: 45000,
          });
          log(`✅ Using FHRouter vision: ${model}`, 'info');
          return { stream: response.data, provider: 'fhrouter', model };
        } catch (err) {
          const status = err.response?.status;
          errors.push(`fhrouter:${model}`);
          if (status === 429) markCooldown(cdKey, 120);
          if (status === 404 || status === 400) markCooldown(cdKey, 300);
        }
      }
    }
    if (OPENROUTER_API_KEY) {
      for (const model of OPENROUTER_VISION_MODELS) {
        const cdKey = `openrouter-v:${model}`;
        if (isCoolingDown(cdKey)) continue;
        try {
          const visionMessages = chatMessages.map((m, i) => {
            if (i === chatMessages.length - 1 && m.role === 'user') {
              const parts = [];
              if (m.content) parts.push({ type: 'text', text: m.content });
              parts.push({ type: 'image_url', image_url: { url: `data:${imageData.mimeType};base64,${imageData.base64}` } });
              return { role: 'user', content: parts };
            }
            return m;
          });
          const response = await axios.post(OPENROUTER_URL, {
            model, messages: visionMessages, temperature: 0.6, max_tokens: 1500, stream: true,
          }, {
            headers: {
              'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.FRONTEND_URL || 'https://agrideepai.agentdomains.co',
              'X-Title': 'AgriDeepAI',
            },
            responseType: 'stream', timeout: 45000,
          });
          log(`✅ Using OpenRouter vision: ${model}`, 'info');
          return { stream: response.data, provider: 'openrouter', model };
        } catch (err) {
          const status = err.response?.status;
          errors.push(`openrouter:${model}`);
          if (status === 429) markCooldown(cdKey, 120);
          if (status === 404 || status === 400) markCooldown(cdKey, 300);
        }
      }
    }
    log(`Vision path failed (${errors.join(', ') || 'no vision providers'}), retrying text-only`, 'warn');
    return getAIStream(chatMessages, null, true);
  }

  if (groq) {
    for (const model of GROQ_TEXT_MODELS) {
      try {
        const stream = await groq.chat.completions.create({ model, messages: chatMessages, temperature: 0.6, max_tokens: 1500, stream: true });
        log(`✅ Using Groq: ${model}`, 'info');
        return { stream, provider: 'groq', model };
      } catch (err) {
        log(`⚠️ Groq ${model}: ${String(err.message).slice(0, 120)}`, 'warn');
        errors.push(`groq:${model}`);
      }
    }
  }
  if (FHROUTER_API_KEY) {
    for (const model of FHROUTER_TEXT_MODELS) {
      const cdKey = `fhrouter:${model}`;
      if (isCoolingDown(cdKey)) continue;
      try {
        const response = await axios.post(FHROUTER_URL, {
          model, messages: chatMessages, temperature: 0.6, max_tokens: 1500, stream: true,
        }, {
          headers: { 'Authorization': `Bearer ${FHROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          responseType: 'stream', timeout: 45000,
        });
        log(`✅ Using FHRouter: ${model}`, 'info');
        return { stream: response.data, provider: 'fhrouter', model };
      } catch (err) {
        const status = err.response?.status;
        log(`⚠️ FHRouter ${model}: ${status || err.message}`, 'warn');
        errors.push(`fhrouter:${model}`);
        if (status === 429) markCooldown(cdKey, 120);
        if (status === 404 || status === 400) markCooldown(cdKey, 300);
      }
    }
  }
  if (OPENROUTER_API_KEY) {
    for (const model of OPENROUTER_TEXT_MODELS) {
      const cdKey = `openrouter:${model}`;
      if (isCoolingDown(cdKey)) continue;
      try {
        const response = await axios.post(OPENROUTER_URL, {
          model, messages: chatMessages, temperature: 0.6, max_tokens: 1500, stream: true,
        }, {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.FRONTEND_URL || 'https://agrideepai.agentdomains.co',
            'X-Title': 'AgriDeepAI',
          },
          responseType: 'stream', timeout: 45000,
        });
        log(`✅ Using OpenRouter: ${model}`, 'info');
        return { stream: response.data, provider: 'openrouter', model };
      } catch (err) {
        const status = err.response?.status;
        log(`⚠️ OpenRouter ${model}: ${status || err.message}`, 'warn');
        errors.push(`openrouter:${model}`);
        if (status === 429) markCooldown(cdKey, 120);
        if (status === 404 || status === 400) markCooldown(cdKey, 300);
      }
    }
  }
  throw new Error(`All AI providers failed. Tried: ${errors.join(', ')}`);
}

function consumeGroqStream(stream, res, onDone) {
  let full = '';
  (async () => {
    try {
      for await (const chunk of stream) {
        const text = chunk.choices?.[0]?.delta?.content || '';
        if (text) { full += text; res.write(`data: ${JSON.stringify({ text })}\n\n`); }
      }
      if (onDone) await onDone(full);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      log(`Groq stream error: ${err.message}`, 'error');
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); }
    }
  })();
}

function consumeOpenAICompatibleStream(stream, res, onDone) {
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
          if (text) { full += text; res.write(`data: ${JSON.stringify({ text })}\n\n`); }
        } catch (e) {}
      }
    }
  });
  stream.on('end', async () => {
    try { if (onDone) await onDone(full); } catch (e) { log(`onDone error: ${e.message}`, 'error'); }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  stream.on('error', (err) => {
    log(`Stream error: ${err.message}`, 'error');
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); }
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
    else consumeOpenAICompatibleStream(stream, res, onDone);
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

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return null;
  let q = (query || '').trim();
  if (q.length < 3) return null;
  if (q.length > 1400) q = q.substring(0, 1400);
  try {
    const r = await axios.post('https://api.tavily.com/search', {
      query: q, search_depth: 'basic',
      include_answer: true, include_raw_content: false, include_images: false, max_results: 4,
    }, {
      headers: { 'Authorization': `Bearer ${TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    return r.data;
  } catch (err) {
    const detail = err.response?.data?.detail || err.response?.data?.error || err.response?.status || err.message;
    log(`Tavily error: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, 'warn');
    return null;
  }
}

const LOGO_URL = (process.env.FRONTEND_URL || '') + '/logo.png';

const SYSTEM_PROMPT = `You are **AgriDeepAI**, an expert AI assistant specialised in agriculture, livestock, and directly related sciences.

## IDENTITY (never violate)
- Your name is **AgriDeepAI**. Created by **Ornella Mutuyimana**, a Rwandan technology enthusiast.
- You are NEVER "Nex", "Nex-AGI", "Llama", "GPT", "Claude", "Gemini", or any other AI.

## ROLE
Help with:
- **Crops**: maize, beans, cassava, coffee, tea, banana, rice, vegetables, fruits, spices, herbs
- **Livestock**: cattle, goats, poultry, pigs, rabbits, fish, bees
- **Soil, water, fertilisers, compost, irrigation, drainage**
- **Pests, diseases, weeds**
- **Post-harvest**: storage, processing, packaging
- **Agribusiness**: markets, pricing, cooperatives, value chains, agri-tech
- **Farm machinery, tools, structures**
- **Agriculture-adjacent science**: plant/animal biology (photosynthesis, glucose, chlorophyll, digestion), chemistry (NPK, pH, soil chemistry), physics (water cycles), weather, climate
- **Nutrition of farm produce**, food security
- **Agricultural education, research, schooling questions**
- **Where to find**: seeds, fertilisers, veterinary services, extension services
- **Natural conversation** in English, Kinyarwanda, French, Swahili — greetings, small talk, general knowledge that keeps the conversation flowing. Reply in the user's language when possible.

## REFUSE
Politely decline questions with no meaningful connection to agriculture, livestock, rural life, or their sciences (music, sports, politics, unrelated tech, unrelated history, fashion, personal advice). Short reply:
"I'm AgriDeepAI, specialised in agriculture and livestock, so I can't help with that. If you have a question about crops, livestock, soil, farming, or agribusiness, I'd be glad to help."
Do NOT provide the off-topic answer.

## IMAGES & DOCUMENTS
- If the upload IS related to agriculture/livestock, analyse it fully.
- If clearly unrelated, reply: "This doesn't appear to be related to agriculture or livestock. If you have a farming question, feel free to share it."

## STYLE
Warm, professional, concise. Markdown when it helps. Ask for symptoms/age/weather for disease questions. Include short disclaimers for chemicals and animal health.`;

const storage = multer.memoryStorage();
const upload = multer({
  storage, limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'), false);
  }
});

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = user;
  req.token = token;
  next();
}

const getClientId = (req) => {
  const id = (req.headers['x-client-id'] || '').toString().trim();
  return id ? id.slice(0, 80) : null;
};
const getRequestIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'Unknown';
const getRequestUa = (req) => req.headers['user-agent'] || 'Unknown';

function isGreetingOnly(text) {
  const t = (text || '').toLowerCase().trim().replace(/[!?.,;:]/g, '').replace(/\s+/g, ' ');
  const greetings = ['hi','hello','hey','hi there','hello there','good morning','good afternoon','good evening','yo','sup','howdy',
    'muraho','mwaramutse','mwiriwe','amakuru','bite','salam','bonjour','salut','jambo','habari','hi bot','hello bot'];
  return greetings.includes(t);
}
function isGreeting(text) {
  const t = (text || '').toLowerCase().trim().replace(/[!?.,]/g, '');
  const greetings = ['hi','hello','hey','hi there','hello there','good morning','good afternoon','good evening','yo','sup','howdy',
    'muraho','mwaramutse','mwiriwe','amakuru','bite','salam','bonjour','salut','jambo','habari'];
  return greetings.includes(t) || greetings.some(g => t.startsWith(g + ' '));
}
function isCreatorQuestion(text) {
  const t = (text || '').toLowerCase();
  const keys = ['who made you','who built you','who created you','who is your creator','who is your developer','who is behind','who founded','who develops','who is the creator of','who is the developer of','who made this','who built this','who created this','who are you','what are you','who is your maker','who is your owner','who owns you','witwa nde','uri nde','ni nde'];
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
    const t = last.content.toLowerCase();
    if (t.includes('muraho') || t.includes('mwaramutse') || t.includes('mwiriwe') || t.includes('amakuru') || t.includes('bite'))
      await streamSimpleText(res, `Muraho! Ni **AgriDeepAI**. Ni gute nashobora kugufasha ku bijyanye n'ubuhinzi cyangwa ubworozi uyu munsi?`);
    else if (t.includes('bonjour') || t.includes('salut'))
      await streamSimpleText(res, `Bonjour ! Je suis **AgriDeepAI**. Comment puis-je vous aider aujourd'hui avec l'agriculture ou l'élevage ?`);
    else if (t.includes('jambo') || t.includes('habari'))
      await streamSimpleText(res, `Habari! Mimi ni **AgriDeepAI**. Ninaweza kukusaidia vipi leo kuhusu kilimo au ufugaji?`);
    else
      await streamSimpleText(res, `Hello! I'm **AgriDeepAI**. How can I help you with agriculture or livestock today?`);
    return true;
  }
  return false;
}

async function generateChatTitle(userMessage) {
  const msg = (userMessage || '').trim();
  if (!msg) return 'New Chat';

  if (isGreetingOnly(msg)) return 'Greeting';
  if (isCreatorQuestion(msg)) return 'About AgriDeepAI';

  const prompt = `You write short titles for chat conversations, in the style of ChatGPT sidebar names.

Read the USER MESSAGE below. Reply with ONLY the conversation title — never repeat the user's exact words.

Strict rules:
- 2 to 6 words. Title Case or sentence case.
- Focus on the TOPIC or INTENT (what they are asking about), not a quote of their sentence.
- No quotation marks, no trailing period, no prefix like "Title:" or "Chat:".
- If the message is a greeting or small talk, reply exactly: Greeting
- If the message asks who you are / who made you, reply exactly: About AgriDeepAI
- If the message asks for the meaning/definition of something, use the pattern: Meaning of X
- If the message asks how to do something, use the pattern: How to X
- If the message describes a problem, use the pattern: X Problem or X Diagnosis

Examples:
USER: "Hi, what is your name?" → Greeting and Introduction
USER: "What is the agriculture mean?" → Meaning of Agriculture
USER: "How do I treat tomato blight?" → Tomato Blight Treatment
USER: "My maize leaves are yellow with brown spots, what should I do?" → Maize Leaf Yellowing Diagnosis
USER: "how to raise chickens for eggs" → Raising Chickens for Eggs
USER: "Tell me about dairy cow feed" → Dairy Cow Feeding
USER: "Hello" → Greeting
USER: "Who created you?" → About AgriDeepAI

USER MESSAGE:
${msg.substring(0, 800)}

Title:`;

  const cleanTitle = (raw) => {
    let t = String(raw || '').trim();
    t = t.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').replace(/\.+$/, '').trim();
    if (/^(title|chat title|chat)\s*[:\-]\s*/i.test(t)) t = t.replace(/^(title|chat title|chat)\s*[:\-]\s*/i, '').trim();
    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const short = lines.find(l => l.length <= 60 && !/^(sure|here|the title)/i.test(l)) || lines[0];
      t = short;
    }
    if (t.length === 0) return null;
    const msgNorm = msg.toLowerCase().replace(/\s+/g, ' ').trim();
    const tNorm = t.toLowerCase().replace(/\s+/g, ' ').trim();
    if (tNorm === msgNorm) return null;
    if (t.length > 80) t = t.substring(0, 80).trim();
    return t;
  };

  if (groq) {
    for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 400,
        });
        const raw = completion.choices?.[0]?.message?.content;
        const title = cleanTitle(raw);
        if (title) {
          log(`Title (groq ${model}): "${title}"`, 'debug');
          return title;
        }
        log(`Title gen (groq ${model}) produced empty/unusable response: ${JSON.stringify(raw).slice(0, 120)}`, 'warn');
      } catch (err) {
        log(`Title gen (groq ${model}) error: ${String(err.message).slice(0, 160)}`, 'warn');
      }
    }
  }
  if (FHROUTER_API_KEY) {
    for (const model of FHROUTER_TEXT_MODELS.slice(0, 2)) {
      try {
        const r = await axios.post(FHROUTER_URL, {
          model, messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 400, stream: false,
        }, {
          headers: { 'Authorization': `Bearer ${FHROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          timeout: 20000,
        });
        const raw = r.data?.choices?.[0]?.message?.content;
        const title = cleanTitle(raw);
        if (title) {
          log(`Title (fhrouter ${model}): "${title}"`, 'debug');
          return title;
        }
      } catch (err) {
        log(`Title gen (fhrouter ${model}) error: ${String(err.message).slice(0, 160)}`, 'warn');
      }
    }
  }
  if (OPENROUTER_API_KEY) {
    for (const model of OPENROUTER_TEXT_MODELS) {
      try {
        const r = await axios.post(OPENROUTER_URL, {
          model, messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 400, stream: false,
        }, {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.FRONTEND_URL || 'https://agrideepai.agentdomains.co',
            'X-Title': 'AgriDeepAI',
          },
          timeout: 20000,
        });
        const raw = r.data?.choices?.[0]?.message?.content;
        const title = cleanTitle(raw);
        if (title) {
          log(`Title (openrouter ${model}): "${title}"`, 'debug');
          return title;
        }
      } catch (err) {
        log(`Title gen (openrouter ${model}) error: ${String(err.message).slice(0, 160)}`, 'warn');
      }
    }
  }
  const firstWords = msg.split(/\s+/).slice(0, 5).join(' ');
  return firstWords + (msg.split(/\s+/).length > 5 ? '…' : '');
}

async function sendEmail(to, subject, htmlContent) {
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = htmlContent;
  sendSmtpEmail.sender = { name: 'AgriDeepAI', email: 'noreply@agrideepai.agentdomains.co' };
  sendSmtpEmail.to = [{ email: to }];
  const result = await brevoApi.sendTransacEmail(sendSmtpEmail);
  return result;
}

async function sendVerificationEmailWithRetry(email, code, action = 'verify', extra = '') {
  try {
    await sendVerificationEmail(email, code, action, extra);
    return true;
  } catch (firstErr) {
    log(`[EMAIL] First attempt failed for ${email} (${action}): ${firstErr.message}. Retrying in 1.5s...`, 'warn');
    await new Promise(r => setTimeout(r, 1500));
    try {
      await sendVerificationEmail(email, code, action, extra);
      log(`[EMAIL] ✅ Retry succeeded for ${email} (${action})`, 'info');
      return true;
    } catch (secondErr) {
      log(`[EMAIL] ❌ Retry also failed for ${email} (${action}): ${secondErr.message}`, 'error');
      throw secondErr;
    }
  }
}

async function sendVerificationEmail(email, code, action = 'verify', extra = '') {
  const expiration = '10 minutes';
  const actionMap = {
    'verify': 'Verify your account','change-email': 'Change your email',
    'change-password': 'Change your password','delete-account': 'Delete your account',
    'signup': 'Complete your registration','login': 'Complete your sign-in',
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
  await sendEmail(email, subject, htmlContent);
  log(`Verification email sent to ${email} (${action})`, 'info');
}

async function sendLoginNotification(email, ip, device, time) {
  try {
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>New sign-in to AgriDeepAI</title>
      <style>body{font-family:Arial,sans-serif;background:#f4f4f4;padding:20px}
      .container{max-width:560px;margin:0 auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.1)}
      .logo{text-align:center;margin-bottom:20px}.logo img{height:60px}
      h1{color:#1e232a;font-size:22px;margin:0 0 8px}p{color:#555;font-size:15px;line-height:1.6}
      .info{background:#f8f9fa;border-radius:8px;padding:15px;margin:15px 0;font-size:14px}
      .info strong{color:#1e232a}
      .footer{margin-top:30px;font-size:13px;color:#888;border-top:1px solid #eee;padding-top:20px;text-align:center}</style>
      </head><body><div class="container">
      <div class="logo"><img src="${LOGO_URL}" alt="AgriDeepAI" /></div>
      <h1>New sign-in to your AgriDeepAI account</h1>
      <p>We noticed a new sign-in to your account. If this was you, you can safely ignore this email.</p>
      <div class="info">
        <p><strong>Time:</strong> ${time}</p>
        <p><strong>IP address:</strong> ${ip}</p>
        <p><strong>Device:</strong> ${device}</p>
      </div>
      <p>If this wasn't you, please change your password immediately and review your active sessions.</p>
      <div class="footer">&copy; 2026 AgriDeepAI. All rights reserved.</div>
      </div></body></html>`;
    await sendEmail(email, 'New sign-in to your AgriDeepAI account', htmlContent);
    log(`Login notification email sent to ${email}`, 'info');
  } catch (err) { log(`Login notification error: ${err.message}`, 'error'); }
}

async function trackSession(userId, email, req) {
  try {
    const ua = getRequestUa(req);
    const ip = getRequestIp(req);
    const clientId = getClientId(req);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recent, error: recentErr } = await supabase.from('sessions')
      .select('*').eq('user_id', userId).gte('last_active', thirtyDaysAgo);
    if (recentErr) log(`trackSession read error: ${recentErr.message}`, 'warn');

    const existing = (recent || []).find(s =>
      (clientId && s.client_id === clientId)
      || (s.ip === ip && s.user_agent === ua)
    );
    const hasAnyPrevious = !!(recent && recent.length > 0);

    if (existing) {
      const { error: upErr } = await supabase.from('sessions').update({
        device: ua.substring(0, 120),
        ip,
        user_agent: ua,
        last_active: new Date().toISOString(),
        client_id: clientId || existing.client_id || null,
      }).eq('id', existing.id);
      if (upErr) log(`trackSession update error: ${upErr.message}`, 'error');
    } else {
      const { error: insErr } = await supabase.from('sessions').insert({
        user_id: userId,
        device: ua.substring(0, 120),
        ip,
        user_agent: ua,
        client_id: clientId || null,
      });
      if (insErr) log(`trackSession insert error: ${insErr.message}`, 'error');
      if (hasAnyPrevious && email) {
        sendLoginNotification(email, ip, ua.substring(0, 120), new Date().toLocaleString())
          .catch(e => log(`Login notification failed: ${e.message}`, 'warn'));
      }
    }
  } catch (err) { log(`trackSession error: ${err.message}`, 'warn'); }
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
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const pendingToken = signPending({ type: 'signup', email, code, password, fullName: fullName || email.split('@')[0] });
    await sendVerificationEmailWithRetry(email, code, 'signup', 'To complete your registration, use the code below.');
    res.status(200).json({ message: 'Verification code sent to your email.', email, pendingToken });
  } catch (err) {
    log(`[SIGNUP] Error: ${err.message}`, 'error');
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

app.post('/api/auth/confirm-signup', async (req, res) => {
  try {
    const { pendingToken, code } = req.body;
    const p = verifyPending(pendingToken);
    if (!p || p.type !== 'signup') return res.status(400).json({ error: 'Pending session expired. Please sign up again.' });
    if (p.code !== code) return res.status(400).json({ error: 'Invalid or expired code.' });
    const { email, password, fullName } = p;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, email_confirm: true } });
    if (error) throw error;
    if (!data.user) throw new Error('User creation failed');
    await supabase.auth.admin.updateUserById(data.user.id, { email_confirm: true });
    await supabase.from('profiles').insert({ id: data.user.id, full_name: fullName });
    const { data: sd, error: se } = await supabase.auth.signInWithPassword({ email, password });
    if (se) throw se;
    await trackSession(sd.user.id, sd.user.email, req);
    res.status(201).json({ user: sd.user, session: sd.session });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ============ RESEND VERIFICATION (signup) ============
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { pendingToken } = req.body;
    log(`[RESEND-SIGNUP] Request received. Token length: ${pendingToken ? pendingToken.length : 0}`, 'info');

    if (!pendingToken) {
      log(`[RESEND-SIGNUP] No pendingToken provided`, 'warn');
      return res.status(400).json({ error: 'Your session expired. Please sign up again.' });
    }

    const p = verifyPending(pendingToken);
    if (!p) {
      log(`[RESEND-SIGNUP] Token verification failed (expired or invalid signature)`, 'warn');
      return res.status(400).json({ error: 'Your session expired. Please sign up again.' });
    }
    if (p.type !== 'signup') {
      log(`[RESEND-SIGNUP] Wrong token type: ${p.type}`, 'warn');
      return res.status(400).json({ error: 'Invalid session. Please sign up again.' });
    }
    if (!p.email || !p.password) {
      log(`[RESEND-SIGNUP] Missing email or password in token`, 'warn');
      return res.status(400).json({ error: 'Session data incomplete. Please sign up again.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // Strip JWT reserved claims (exp/iat/nbf/etc) before re-signing
    const payload = { ...stripJwtClaims(p), code };
    const newToken = signPending(payload);
    log(`[RESEND-SIGNUP] Sending new code to ${p.email}`, 'info');
    await sendVerificationEmailWithRetry(p.email, code, 'signup', 'Resend: complete your registration.');
    log(`[RESEND-SIGNUP] ✅ Success for ${p.email}`, 'info');
    res.json({ message: 'New code sent.', pendingToken: newToken });
  } catch (err) {
    log(`[RESEND-SIGNUP] ❌ Error: ${err.message}`, 'error');
    log(`[RESEND-SIGNUP] Stack: ${err.stack || 'n/a'}`, 'error');
    res.status(500).json({ error: `Failed to resend code: ${err.message || 'unknown error'}` });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: profile } = await supabase.from('profiles').select('two_factor_enabled').eq('id', data.user.id).single();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const pendingToken = signPending({
      type: 'login',
      email,
      code,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      userId: data.user.id,
      userEmail: data.user.email,
      userCreatedAt: data.user.created_at,
      userLastSignInAt: data.user.last_sign_in_at || null,
      two_factor_enabled: !!profile?.two_factor_enabled,
    });
    log(`[LOGIN] Issued pending token (${pendingToken.length} chars) for ${email}`, 'debug');
    await sendVerificationEmailWithRetry(email, code, 'login', 'Use the code below to complete your sign-in.');
    res.json({ requiresCode: true, email, pendingToken, message: 'Verification code sent to your email.' });
  } catch (err) {
    log(`[LOGIN] Error: ${err.message}`, 'warn');
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

// ============ RESEND LOGIN CODE ============
app.post('/api/auth/resend-login-code', async (req, res) => {
  try {
    const { pendingToken } = req.body;
    log(`[RESEND-LOGIN] Request received. Token length: ${pendingToken ? pendingToken.length : 0}`, 'info');

    if (!pendingToken) {
      log(`[RESEND-LOGIN] No pendingToken provided`, 'warn');
      return res.status(400).json({ error: 'Your session expired. Please sign in again.' });
    }

    const p = verifyPending(pendingToken);
    if (!p) {
      log(`[RESEND-LOGIN] Token verification failed (expired or invalid signature)`, 'warn');
      return res.status(400).json({ error: 'Your session expired. Please sign in again.' });
    }
    if (p.type !== 'login') {
      log(`[RESEND-LOGIN] Wrong token type: ${p.type}`, 'warn');
      return res.status(400).json({ error: 'Invalid session. Please sign in again.' });
    }
    if (!p.email) {
      log(`[RESEND-LOGIN] No email in token payload`, 'warn');
      return res.status(400).json({ error: 'Session data missing email. Please sign in again.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // Strip JWT reserved claims (exp/iat/nbf/etc) before re-signing
    const payload = { ...stripJwtClaims(p), code };
    const newToken = signPending(payload);
    log(`[RESEND-LOGIN] Sending new code to ${p.email}`, 'info');
    await sendVerificationEmailWithRetry(p.email, code, 'login', 'Resend: use the code below to complete your sign-in.');
    log(`[RESEND-LOGIN] ✅ Success for ${p.email}`, 'info');
    res.json({ message: 'New code sent.', pendingToken: newToken });
  } catch (err) {
    log(`[RESEND-LOGIN] ❌ Error: ${err.message}`, 'error');
    log(`[RESEND-LOGIN] Stack: ${err.stack || 'n/a'}`, 'error');
    res.status(500).json({ error: `Failed to resend code: ${err.message || 'unknown error'}` });
  }
});

app.post('/api/auth/verify-login', async (req, res) => {
  try {
    const { pendingToken, code } = req.body;
    const p = verifyPending(pendingToken);
    if (!p || p.type !== 'login') return res.status(400).json({ error: 'Pending session expired. Please sign in again.' });
    if (p.code !== code) return res.status(400).json({ error: 'Invalid or expired code.' });
    const user = {
      id: p.userId,
      email: p.userEmail || p.email,
      created_at: p.userCreatedAt,
      last_sign_in_at: p.userLastSignInAt,
    };
    if (p.two_factor_enabled) {
      const twoFactorToken = signPending({
        type: '2fa',
        email: p.email,
        access_token: p.access_token,
        refresh_token: p.refresh_token,
        user,
      });
      return res.json({ requires2fa: true, twoFactorToken, message: 'Email verified. Now enter your 2FA code.' });
    }
    await trackSession(user.id, user.email, req);
    res.json({ user, session: { access_token: p.access_token, refresh_token: p.refresh_token }, message: 'Login successful' });
  } catch (err) { res.status(500).json({ error: 'Verification failed.' }); }
});

app.post('/api/auth/2fa/validate-login', async (req, res) => {
  try {
    const { twoFactorToken, code } = req.body;
    const p = verifyPending(twoFactorToken);
    if (!p || p.type !== '2fa') return res.status(400).json({ error: 'Pending session expired. Please sign in again.' });
    const { data: profile } = await supabase.from('profiles').select('two_factor_secret').eq('id', p.user.id).single();
    if (!profile?.two_factor_secret) return res.status(400).json({ error: '2FA not set up' });
    const verified = speakeasy.totp.verify({ secret: profile.two_factor_secret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(400).json({ error: 'Invalid 2FA code' });
    await trackSession(p.user.id, p.user.email, req);
    res.json({ user: p.user, session: { access_token: p.access_token, refresh_token: p.refresh_token }, message: 'Login successful' });
  } catch (err) { res.status(500).json({ error: 'Failed to validate 2FA' }); }
});

app.post('/api/auth/send-verification-code', authenticate, async (req, res) => {
  try {
    const { action } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const pendingToken = signPending({ type: 'action', action, userId: req.user.id, email: req.user.email, code });
    await sendVerificationEmailWithRetry(req.user.email, code, action);
    res.json({ message: 'Verification code sent.', pendingToken });
  } catch (err) { res.status(500).json({ error: 'Failed to send code.' }); }
});

// Resend for ACTION endpoints (change email/password/delete)
app.post('/api/auth/resend-action-code', authenticate, async (req, res) => {
  try {
    const { pendingToken } = req.body;
    log(`[RESEND-ACTION] Request received for user ${req.user.id}`, 'info');
    const p = verifyPending(pendingToken);
    if (!p || p.type !== 'action' || p.userId !== req.user.id) {
      log(`[RESEND-ACTION] Invalid token`, 'warn');
      return res.status(400).json({ error: 'Your session expired. Please try again.' });
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // Strip JWT reserved claims (exp/iat/nbf/etc) before re-signing
    const payload = { ...stripJwtClaims(p), code };
    const newToken = signPending(payload);
    await sendVerificationEmailWithRetry(req.user.email, code, p.action);
    log(`[RESEND-ACTION] ✅ Sent new code for action ${p.action}`, 'info');
    res.json({ message: 'New code sent.', pendingToken: newToken });
  } catch (err) {
    log(`[RESEND-ACTION] ❌ Error: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed to resend code: ${err.message || 'unknown error'}` });
  }
});

app.post('/api/auth/verify-code', authenticate, async (req, res) => {
  try {
    const { pendingToken, code, action } = req.body;
    const p = verifyPending(pendingToken);
    if (!p || p.type !== 'action' || p.userId !== req.user.id) return res.status(400).json({ error: 'Pending session expired.' });
    if (p.code !== code || p.action !== action) return res.status(400).json({ error: 'Invalid or expired code' });
    const grantedToken = signPending({ type: 'granted', action, userId: req.user.id }, 600);
    res.json({ message: 'Code verified.', grantedToken });
  } catch (err) { res.status(500).json({ error: 'Verification failed.' }); }
});

app.post('/api/auth/verify-current-password', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const { error } = await supabase.auth.signInWithPassword({ email: req.user.email, password });
    if (error) return res.status(401).json({ error: 'Current password is incorrect' });
    res.json({ valid: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword, grantedToken } = req.body;
    const g = verifyPending(grantedToken);
    if (!g || g.type !== 'granted' || g.action !== 'change-password' || g.userId !== req.user.id)
      return res.status(400).json({ error: 'Please verify your code first.' });
    const { error: si } = await supabase.auth.signInWithPassword({ email: req.user.email, password: currentPassword });
    if (si) return res.status(401).json({ error: 'Current password incorrect' });
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword))
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
    if (newPassword === currentPassword)
      return res.status(400).json({ error: 'New password must be different from current password' });
    await supabase.auth.updateUser({ password: newPassword });
    res.json({ message: 'Password changed successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/change-email', authenticate, async (req, res) => {
  try {
    const { newEmail, grantedToken } = req.body;
    const g = verifyPending(grantedToken);
    if (!g || g.type !== 'granted' || g.action !== 'change-email' || g.userId !== req.user.id)
      return res.status(400).json({ error: 'Please verify your code first.' });
    await supabase.auth.updateUser({ email: newEmail });
    res.json({ message: 'Email change requested.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/auth/delete-account', authenticate, async (req, res) => {
  try {
    const { grantedToken } = req.body;
    const g = verifyPending(grantedToken);
    if (!g || g.type !== 'granted' || g.action !== 'delete-account' || g.userId !== req.user.id)
      return res.status(400).json({ error: 'Please verify your code first.' });
    await supabase.from('sessions').delete().eq('user_id', req.user.id);
    await supabase.auth.admin.deleteUser(req.user.id);
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
    res.json({ secret: secret.base32, otpauth_url: secret.otpauth_url, qrCodeDataUrl });
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

app.get('/api/auth/sessions', authenticate, async (req, res) => {
  try {
    const ua = getRequestUa(req);
    const ip = getRequestIp(req);
    const { data: sessions, error } = await supabase.from('sessions').select('*').eq('user_id', req.user.id).order('last_active', { ascending: false });
    if (error) log(`sessions fetch error: ${error.message}`, 'warn');
    res.json({
      current: { user_agent: ua, ip, signed_in_at: new Date().toISOString(), email: req.user.email },
      all: sessions || [],
      account: { created_at: req.user.created_at, last_sign_in_at: req.user.last_sign_in_at, email: req.user.email },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/session-check', authenticate, async (req, res) => {
  try {
    const ua = getRequestUa(req);
    const ip = getRequestIp(req);
    const clientId = getClientId(req);
    if (clientId) {
      const { data, error } = await supabase.from('sessions').select('id').eq('user_id', req.user.id).eq('client_id', clientId).limit(1);
      if (error) log(`session-check error: ${error.message}`, 'warn');
      if (data && data.length > 0) return res.json({ valid: true });
    }
    const { data: byIpUa } = await supabase.from('sessions').select('id').eq('user_id', req.user.id).eq('ip', ip).eq('user_agent', ua).limit(1);
    if (byIpUa && byIpUa.length > 0) {
      if (clientId) await supabase.from('sessions').update({ client_id: clientId }).eq('id', byIpUa[0].id);
      return res.json({ valid: true });
    }
    return res.json({ valid: false });
  } catch (err) {
    return res.json({ valid: true, error: err.message });
  }
});

app.delete('/api/auth/sessions/all', authenticate, async (req, res) => {
  try {
    const ua = getRequestUa(req);
    const ip = getRequestIp(req);
    const clientId = getClientId(req);
    const { data: sessions } = await supabase.from('sessions').select('*').eq('user_id', req.user.id).order('last_active', { ascending: false });
    const list = sessions || [];
    const mine = clientId
      ? list.filter(s => s.client_id === clientId)
      : list.filter(s => s.ip === ip && s.user_agent === ua);
    const keepId = mine[0]?.id;
    const idsToDelete = list.filter(s => s.id !== keepId).map(s => s.id);
    if (idsToDelete.length > 0) {
      await supabase.from('sessions').delete().in('id', idsToDelete);
    }
    try { await supabase.auth.admin.signOut(req.token, 'others'); }
    catch (e) { log(`Supabase signOut(others) failed: ${e.message}`, 'warn'); }
    res.json({ message: 'All other sessions logged out', removed: idsToDelete.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/auth/sessions/current', authenticate, async (req, res) => {
  try {
    const ua = getRequestUa(req);
    const ip = getRequestIp(req);
    const clientId = getClientId(req);
    const { data: sessions } = await supabase.from('sessions').select('*').eq('user_id', req.user.id);
    const list = sessions || [];
    const mine = clientId
      ? list.filter(s => s.client_id === clientId)
      : list.filter(s => s.ip === ip && s.user_agent === ua);
    if (mine[0]?.id) {
      await supabase.from('sessions').delete().eq('id', mine[0].id).eq('user_id', req.user.id);
    }
    res.json({ message: 'Current session removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/auth/sessions/:id', authenticate, async (req, res) => {
  try {
    await supabase.from('sessions').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ message: 'Session removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// ============ CHAT ============
function buildChatMessages(messages, systemPrompt = SYSTEM_PROMPT) {
  const history = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && String(m.content).trim()).map(m => ({ role: m.role, content: String(m.content || '') }));
  return [{ role: 'system', content: systemPrompt }, ...history];
}
async function enrichWithWebSearch(query) {
  if (!TAVILY_API_KEY) return query;
  const sr = await tavilySearch(query);
  if (sr?.answer) return `${query}\n\n[Current web information, use if relevant]\n${sr.answer}`;
  return query;
}
async function extractTextFromFile(file) {
  try {
    if (file.mimetype === 'application/pdf') { const data = await pdfParse(file.buffer); return (data.text || '').trim().substring(0, 8000); }
    if (file.mimetype.startsWith('text/')) return file.buffer.toString('utf-8').substring(0, 8000);
    if (file.mimetype.startsWith('image/')) return (await ocrImage(file.buffer, file.originalname, file.mimetype)) || '';
    return '';
  } catch (err) { log(`Text extraction error: ${err.message}`, 'warn'); return ''; }
}

app.post('/api/chat/title', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message required' });
    }
    const title = await generateChatTitle(message);
    res.json({ title });
  } catch (err) {
    log(`Title endpoint error: ${err.message}`, 'warn');
    res.status(500).json({ error: 'Failed to generate title' });
  }
});

app.post('/api/chat/guest', async (req, res) => {
  try {
    const { messages, image } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Messages required' });
    if (await tryIdentityShortcut(messages, res)) return;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return res.status(400).json({ error: 'No user message' });
    const enrichedPrompt = await enrichWithWebSearch(lastUser.content || '');
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

app.get('/api/chat/conversations', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.from('conversations').select('*').eq('user_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/chat/conversations', authenticate, async (req, res) => {
  try {
    const { title } = req.body;
    const { data, error } = await supabase.from('conversations').insert({ user_id: req.user.id, title: title || 'New Chat' }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/chat/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params; const { title, pinned, archived } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (pinned !== undefined) updates.pinned = pinned;
    if (archived !== undefined) updates.archived = archived;
    const { data, error } = await supabase.from('conversations').update(updates).eq('id', id).eq('user_id', req.user.id).select().single();
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
    const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', req.params.id).order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/conversations/:id/messages', authenticate, upload.array('file', 5), async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { message } = req.body;
    const files = req.files || [];
    const { data: conv } = await supabase.from('conversations').select('id, title').eq('id', conversationId).eq('user_id', req.user.id).single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    if (message && files.length === 0 && (isCreatorQuestion(message) || isGreeting(message))) {
      await supabase.from('messages').insert({ conversation_id: conversationId, role: 'user', content: message });
      let reply;
      if (isCreatorQuestion(message)) reply = `I'm **AgriDeepAI**, created by **Ornella Mutuyimana**, a Rwandan technology enthusiast. How can I help you today?`;
      else {
        const t = message.toLowerCase();
        if (t.includes('muraho') || t.includes('mwaramutse') || t.includes('mwiriwe') || t.includes('amakuru') || t.includes('bite')) reply = `Muraho! Ni **AgriDeepAI**. Ni gute nashobora kugufasha ku bijyanye n'ubuhinzi cyangwa ubworozi uyu munsi?`;
        else reply = `Hello! I'm **AgriDeepAI**. How can I help you with agriculture or livestock today?`;
      }
      const { error: aiErr } = await supabase.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: reply, versions: [reply], current_version_index: 0 });
      if (aiErr) log(`Identity reply insert error: ${aiErr.message}`, 'error');
      if (conv.title === 'New Chat' || !conv.title) {
        const newTitle = await generateChatTitle(message);
        await supabase.from('conversations').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', conversationId);
      } else {
        await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
      }
      return streamSimpleText(res, reply);
    }

    let filesMeta = [], imageData = null, extractedText = '';
    for (const file of files) {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `${req.user.id}/${fileName}`;
      const { error: upErr } = await supabase.storage.from(storageBucket).upload(filePath, file.buffer, { contentType: file.mimetype });
      if (upErr) log(`Storage upload error: ${upErr.message}`, 'warn');
      const { data: pu } = supabase.storage.from(storageBucket).getPublicUrl(filePath);
      filesMeta.push({ filename: file.originalname, storage_path: filePath, mime_type: file.mimetype, size: file.size, public_url: pu.publicUrl });
      await supabase.from('files').insert({ user_id: req.user.id, filename: file.originalname, storage_path: filePath, mime_type: file.mimetype, size: file.size });
      if (!imageData && file.mimetype.startsWith('image/') && file.size < 4 * 1024 * 1024) imageData = { base64: file.buffer.toString('base64'), mimeType: file.mimetype };
      const txt = await extractTextFromFile(file);
      if (txt) extractedText += (extractedText ? '\n\n' : '') + txt;
    }

    const messageData = { conversation_id: conversationId, role: 'user', content: message || '' };
    if (filesMeta.length > 0) messageData.files = filesMeta;
    const { error: userMsgErr } = await supabase.from('messages').insert(messageData);
    if (userMsgErr) log(`User message insert error: ${userMsgErr.message}`, 'error');

    if ((conv.title === 'New Chat' || !conv.title) && message) {
      const newTitle = await generateChatTitle(message);
      await supabase.from('conversations').update({ title: newTitle }).eq('id', conversationId);
    }

    const { data: history } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    let enrichedPrompt = await enrichWithWebSearch(message || 'agriculture update');
    if (extractedText) enrichedPrompt += `\n\n[Content from uploaded file]\n${extractedText}`;
    const withoutLast = aiMessages.slice(0, -1);
    const chatMessages = buildChatMessages([...withoutLast, { role: 'user', content: enrichedPrompt }]);

    await streamAI(chatMessages, res, imageData, async (full) => {
      const { error: aiMsgErr } = await supabase.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: full, versions: [full], current_version_index: 0 });
      if (aiMsgErr) log(`Assistant message insert error: ${aiMsgErr.message}`, 'error');
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
    const { data: all } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    if (messageIndex >= all.length || all[messageIndex].role !== 'assistant') return res.status(400).json({ error: 'Invalid index' });
    const idsToDelete = all.slice(messageIndex).map(m => m.id);
    if (idsToDelete.length) await supabase.from('messages').delete().in('id', idsToDelete);
    const { data: remaining } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    if (!remaining.length || remaining[remaining.length - 1].role !== 'user') return res.status(400).json({ error: 'No user message' });
    const chatMessages = buildChatMessages(remaining);
    await streamAI(chatMessages, res, null, async (full) => {
      await supabase.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: full });
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/chat/messages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, truncate } = req.body;
    const { data: msg } = await supabase.from('messages').select('*, conversation_id, conversations(user_id)').eq('id', id).single();
    if (!msg || msg.conversations.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    if (msg.role !== 'user') return res.status(400).json({ error: 'Only user messages can be edited' });
    await supabase.from('messages').update({ content }).eq('id', id);
    if (truncate) {
      const { data: later } = await supabase.from('messages').select('id').eq('conversation_id', msg.conversation_id).gt('created_at', msg.created_at);
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
    const { data: conv } = await supabase.from('conversations').select('id').eq('id', id).eq('user_id', req.user.id).single();
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
  } catch (err) { res.status(500).json({ error: 'Failed to generate share link.' }); }
});

app.get('/api/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    let { data } = await supabase.from('shared_links').select('conversation_id').eq('token', token).single();
    if (data?.conversation_id) {
      const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', data.conversation_id).order('created_at', { ascending: true });
      return res.json({ messages: msgs || [] });
    }
    const { data: guestData, error: ge } = await supabase.from('guest_shares').select('messages').eq('token', token).single();
    if (ge || !guestData) return res.status(404).json({ error: 'Share not found' });
    res.json({ messages: guestData.messages });
  } catch (err) { res.status(500).json({ error: 'Error retrieving shared messages' }); }
});

// ============ SERVE FRONTEND ============
const frontendPath = path.join(__dirname, '../frontend');

app.get('/share/*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(frontendPath, 'share.html'));
});
app.use(express.static(frontendPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.listen(PORT, () => {
  log(`🚀 AgriDeepAI running on port ${PORT}`, 'info');
  log(`Primary: ${GROQ_API_KEY ? 'Groq' : 'none'} | Secondary: ${FHROUTER_API_KEY ? 'FHRouter' : 'none'} | Fallback: ${OPENROUTER_API_KEY ? 'OpenRouter' : 'none'}`, 'info');
  log(`OCR: ${OCR_SPACE_API_KEY ? 'enabled' : 'disabled'} | Tavily: ${TAVILY_API_KEY ? 'enabled' : 'disabled'}`, 'info');
  log(`JWT_SECRET: ${process.env.JWT_SECRET ? 'set' : 'DEFAULT — set JWT_SECRET in env!'}`, process.env.JWT_SECRET ? 'info' : 'warn');
});
