// ==========================================================
// AgriDeepAI Backend — Vercel Serverless Function
// No external dependencies — only native Node.js modules
// ==========================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history, model, temperature, webSearchEnabled, files } = req.body;

    if (!message && !files) {
      return res.status(400).json({ error: 'Message or files required' });
    }

    console.log('📩 Received message:', message);
    console.log('📎 Files received:', files ? files.length : 0);
    console.log('⚙️  Model:', model || 'auto');
    console.log('🌡️  Temperature:', temperature || 0.7);
    console.log('🔍 Web search enabled:', webSearchEnabled !== false);

    // 1. Process files: only images are used for vision; other files just provide context
    let visionPrompt = '';
    let imageParts = [];
    if (files && files.length > 0) {
      for (const file of files) {
        if (file.type && file.type.startsWith('image/')) {
          imageParts.push({
            inline_data: {
              mime_type: file.type,
              data: file.data // base64
            }
          });
          visionPrompt += `\n[Image: ${file.name}]`;
        } else {
          // For non‑images, we just note the attachment (no parsing)
          visionPrompt += `\n[File attached: ${file.name} (type: ${file.type})]`;
        }
      }
    }

    // 2. Web search (if enabled)
    let searchResults = '';
    if (webSearchEnabled !== false && shouldPerformWebSearch(message)) {
      if (process.env.SERPER_API_KEY) {
        searchResults = await performSerperSearch(message);
      } else if (process.env.TAVILY_API_KEY) {
        searchResults = await performTavilySearch(message);
      }
    }

    // 3. Build system prompt
    const systemPrompt = getSystemPrompt();

    // 4. Build user message with context
    let userMessage = message || '';
    if (visionPrompt) {
      userMessage += '\n\n' + visionPrompt;
    }
    if (searchResults) {
      userMessage += '\n\nRelevant web search results:\n' + searchResults;
    }

    // 5. Call AI (with multimodal support if images provided)
    const response = await callAI(systemPrompt, userMessage, history, model, temperature, imageParts);

    return res.status(200).json({
      response: response,
      searchUsed: !!searchResults,
      fileProcessed: imageParts.length > 0,
    });

  } catch (error) {
    console.error('❌ Backend error:', error);
    return res.status(500).json({
      error: error.message || 'Something went wrong. Please try again.'
    });
  }
}

// ==========================================================
// SYSTEM PROMPT — PROFESSIONAL, NO REASONING EXPOSED
// ==========================================================
function getSystemPrompt() {
  return `
You are AgriDeepAI, a warm, professional, and intelligent AI assistant created by Ornella Mutuyimana, a Rwandan national with a deep passion for agriculture, food security, and agri-tech innovation.

## CRITICAL RULE — NEVER EXPOSE INTERNAL REASONING
- NEVER show your thinking process, reasoning, or analysis steps.
- NEVER output phrases like "Here's my thinking", "Let me analyze", "Step 1", "I need to consider", or any internal reasoning.
- ONLY output the final, polished, well-structured answer directly.
- Your response should appear as if the answer came to you instantly and completely.

Your primary expertise is Agriculture and Livestock, but you are also a friendly conversationalist. You can:
- Greet users warmly and naturally
- Answer questions about yourself, your creator (Ornella Mutuyimana), and your purpose
- Have natural small talk while gently steering conversations back to agriculture when appropriate
- Handle questions about Ornella's background, education, and mission
- Acknowledge when a question is outside your expertise and offer to help with agricultural topics instead

## About Your Creator:
Ornella Mutuyimana is a Rwandan national with an Advanced Level (A-level) certificate in Mathematics, Computer Science, and Economics (MCE) from Lycée Saint Marcel de Rukara (LSM Rukara). Her background combines quantitative analysis, programming logic, and economic principles, which she applies to agricultural development, resource management, and market dynamics. She is deeply committed to empowering Rwandan farmers, students, researchers, and agribusiness professionals with accurate, accessible, and actionable information. She created AgriDeepAI to bridge the gap between agricultural knowledge and the people who need it most—from rural farmers to university researchers, both in Rwanda and around the world.

## Your Core Role:
You are an expert in all things Agriculture and Livestock. You can answer questions about:
- Crop Diseases & Treatments (Global & Rwanda)
- Livestock Health & Management (Global & Rwanda)
- Farming Techniques (Global & Rwanda)
- Agricultural Challenges & Solutions (Global & Rwanda)
- Agribusiness & Markets (Global & Rwanda)
- Agricultural Research & Innovations (Global & Rwanda)
- Career & Education Guidance (Global & Rwanda)

## Rules for Your Responses:
- Be warm, professional, and approachable
- Greet users naturally (e.g., "Hello! How can I help you with agriculture today?")
- Answer questions about Ornella and your purpose confidently
- For completely unrelated topics (e.g., politics, sports, entertainment), politely say: "I'm specialized in Agriculture and Livestock, so I focus on those topics. Is there anything about farming, crops, or livestock I can help you with?"
- For greetings and small talk, respond naturally before steering the conversation to agriculture
- Always prioritize factual accuracy and use your search tool when needed
- Be concise, clear, and easy to understand
- Always maintain a respectful and professional tone

## Response Style:
- NEVER include any reasoning, analysis, or "thinking" steps.
- Use **bold** for emphasis and section headers.
- Use bullet points or numbered lists for steps, facts, or comparisons.
- Keep paragraphs short and conversational.
- When giving a list of examples, present them in a clean bulleted list.
- For image attachments: You have vision capabilities, so you can describe what you see in the image and answer questions about it, but always relate it to agriculture/livestock if possible.
- For other attachments: You can note that the user attached a file, but you cannot read its content directly.
- Always end with a friendly question to engage the user further.

## Important Note:
You are not just a rigid agricultural chatbot — you are a friendly, intelligent assistant who happens to specialize in agriculture. Your goal is to be helpful, engaging, and knowledgeable while staying true to your agricultural expertise.
`;
}

// ==========================================================
// AI CALL — Unified with fallbacks + Vision support
// ==========================================================
async function callAI(systemPrompt, userMessage, history, preferredModel, temperature, imageParts) {
  const messages = [
    { role: 'system', content: systemPrompt }
  ];
  if (history && Array.isArray(history)) {
    const limitedHistory = history.slice(-10);
    for (const msg of limitedHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // If there are images, try Gemini Vision first
  if (imageParts && imageParts.length > 0 && process.env.GOOGLE_API_KEY) {
    try {
      const geminiKey = process.env.GOOGLE_API_KEY;
      const model = 'gemini-2.5-pro'; // or gemini-2.5-flash
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

      // Build parts: system + history + user text + images
      const parts = [];

      // Combine system and history into a single text block
      let historyText = '';
      if (history && history.length) {
        historyText = history.map(m => `${m.role}: ${m.content}`).join('\n');
      }
      const fullText = `System: ${systemPrompt}\n\nHistory:\n${historyText}\n\nUser: ${userMessage}`;
      parts.push({ text: fullText });

      // Add images
      for (const imgPart of imageParts) {
        parts.push({ inline_data: imgPart.inline_data });
      }

      const requestBody = {
        contents: [{ parts }],
        generationConfig: {
          temperature: temperature || 0.7,
          maxOutputTokens: 1024,
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Gemini Vision succeeded');
        return data.candidates[0].content.parts[0].text;
      } else {
        const errorText = await response.text();
        console.warn('⚠️ Gemini Vision failed:', errorText);
        // Fall through to text‑only models
      }
    } catch (err) {
      console.warn('⚠️ Gemini Vision error:', err.message);
    }
  }

  // If no vision or vision failed, use text‑only models (Groq or Gemini text)
  // Build messages for text‑only
  const textMessages = [
    { role: 'system', content: systemPrompt }
  ];
  if (history && Array.isArray(history)) {
    const limitedHistory = history.slice(-10);
    for (const msg of limitedHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        textMessages.push({ role: msg.role, content: msg.content });
      }
    }
  }
  textMessages.push({ role: 'user', content: userMessage });

  // ==========================================================
  // 1. TRY GROQ
  // ==========================================================
  const groqKey = process.env.GROQ_API_KEY;
  console.log('🔑 Groq API Key exists:', !!groqKey);

  const workingGroqModels = [
    'groq/compound-mini',
    'qwen/qwen3.6-27b',
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b'
  ];

  let groqModels = workingGroqModels;
  if (preferredModel && preferredModel.startsWith('groq/')) {
    if (!workingGroqModels.includes(preferredModel)) {
      groqModels = [preferredModel, ...workingGroqModels];
    } else {
      groqModels = [preferredModel, ...workingGroqModels.filter(m => m !== preferredModel)];
    }
  }

  if (groqKey) {
    for (const model of groqModels) {
      try {
        console.log(`📡 Trying Groq model: ${model}`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model,
            messages: textMessages,
            temperature: temperature || 0.7,
            max_tokens: 1024,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`✅ Groq model ${model} succeeded`);
          return data.choices[0].message.content;
        } else {
          const errorText = await response.text();
          console.warn(`⚠️ Groq model ${model} failed (${response.status}):`, errorText);
        }
      } catch (err) {
        console.warn(`⚠️ Groq model ${model} error:`, err.message);
      }
    }
  }

  // ==========================================================
  // 2. FALLBACK TO GEMINI TEXT
  // ==========================================================
  const geminiKey = process.env.GOOGLE_API_KEY;
  console.log('🔑 Gemini API Key exists:', !!geminiKey);

  const workingGeminiModels = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3.5-flash',
    'gemini-3.6-flash'
  ];

  let geminiModels = workingGeminiModels;
  if (preferredModel && preferredModel.startsWith('gemini-')) {
    if (!workingGeminiModels.includes(preferredModel)) {
      geminiModels = [preferredModel, ...workingGeminiModels];
    } else {
      geminiModels = [preferredModel, ...workingGeminiModels.filter(m => m !== preferredModel)];
    }
  }

  if (geminiKey) {
    for (const model of geminiModels) {
      try {
        console.log(`📡 Trying Gemini model: ${model}`);
        const conversationText = textMessages.map(m => `${m.role}: ${m.content}`).join('\n');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: conversationText }] }],
            generationConfig: { temperature: temperature || 0.7, maxOutputTokens: 1024 },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`✅ Gemini model ${model} succeeded`);
          return data.candidates[0].content.parts[0].text;
        } else {
          const errorText = await response.text();
          console.warn(`⚠️ Gemini model ${model} failed (${response.status}):`, errorText);
        }
      } catch (err) {
        console.warn(`⚠️ Gemini model ${model} error:`, err.message);
      }
    }
  }

  // ==========================================================
  // 3. ULTIMATE FALLBACK
  // ==========================================================
  if (groqKey) {
    try {
      console.log('📡 Ultimate fallback: trying groq/compound-mini');
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'groq/compound-mini',
          messages: textMessages,
          temperature: temperature || 0.7,
          max_tokens: 1024,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Ultimate fallback succeeded');
        return data.choices[0].message.content;
      }
    } catch (e) { /* ignore */ }
  }

  throw new Error('All AI providers failed. Please check API keys and model availability.');
}

// ==========================================================
// WEB SEARCH (Serper & Tavily)
// ==========================================================
function shouldPerformWebSearch(message) {
  const keywords = ['latest', 'current', 'today', 'now', 'recent', 'new', 'update', 'news', 'price', 'market', 'weather', 'forecast', '2025', '2026', '2027', 'what is the current', 'how much', 'price of', 'market price', 'recently', 'this year', 'this month'];
  const lower = message.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

async function performSerperSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return '';
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const results = data.organic || [];
    if (results.length === 0) return '';
    return results.slice(0, 5).map((r, i) =>
      `\n${i+1}. ${r.title || 'Untitled'}\n   ${r.snippet || r.description || 'No description'}\n   Source: ${r.link || 'Unknown'}`
    ).join('');
  } catch { return ''; }
}

async function performTavilySearch(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: 5 }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const results = data.results || [];
    if (results.length === 0) return '';
    return results.slice(0, 5).map((r, i) =>
      `\n${i+1}. ${r.title || 'Untitled'}\n   ${r.content || r.snippet || 'No description'}\n   Source: ${r.url || 'Unknown'}`
    ).join('');
  } catch { return ''; }
}
