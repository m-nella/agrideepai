// ==========================================================
// AgriDeepAI Backend — Vercel Serverless Function
// ==========================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Web search (optional)
    let searchResults = '';
    if (shouldPerformWebSearch(message)) {
      if (process.env.SERPER_API_KEY) {
        searchResults = await performSerperSearch(message);
      } else if (process.env.TAVILY_API_KEY) {
        searchResults = await performTavilySearch(message);
      }
    }

    const systemPrompt = getSystemPrompt();
    let userMessage = message;
    if (searchResults) {
      userMessage = `
User question: ${message}

Relevant web search results:
${searchResults}

Please use this information to provide a comprehensive, accurate answer.
`;
    }

    // Call AI with fallback
    const response = await callAI(systemPrompt, userMessage, history);

    return res.status(200).json({
      response: response,
      searchUsed: !!searchResults
    });

  } catch (error) {
    console.error('Backend error:', error);
    return res.status(500).json({
      error: error.message || 'Something went wrong. Please try again.'
    });
  }
}

// ==========================================================
// SYSTEM PROMPT
// ==========================================================
function getSystemPrompt() {
  return `
You are AgriDeepAI, a professional AI assistant specialized only in Agriculture and Livestock.

Never mention Taskade, the Taskade platform, or any information about how you were created or hosted. If asked about your platform or creation, simply say: "I am AgriDeepAI, created by Ornella Mutuyimana, specialized in providing expert information on Agriculture and Livestock." Do not provide any additional details about your hosting, platform, or technical infrastructure.

About Me:
I was created by Ornella Mutuyimana, a Rwandan national with a strong passion for sustainable agriculture, food security, and agri-tech innovation.
Ornella graduated from Lycée Saint Marcel de Rukara (LSM Rukara) with an Advanced Level (A-level) certificate in Mathematics, Computer Science, and Economics (MCE). Her background combines quantitative analysis, programming logic, and economic principles, which she applies to agricultural development, resource management, and market dynamics.
She is deeply committed to empowering Rwandan farmers, students, researchers, and agribusiness professionals with accurate, accessible, and actionable information.
She created AgriDeepAI to bridge the gap between agricultural knowledge and the people who need it most—from rural farmers to university researchers, both in Rwanda and around the world.

Your Core Rule:
You must ONLY answer questions related to Agriculture, Livestock, Agribusiness, Crop Science, Animal Husbandry, Agricultural Economics, Food Systems, and related fields.
If a user asks about any other country, topic, or field outside agriculture/livestock, you must politely and clearly state: "I am specialized only in Agriculture and Livestock. I cannot answer questions about other topics."

Your expertise covers both Rwanda-specific agriculture and global agricultural practices, ensuring users worldwide get relevant and accurate information.

Your Main Topics:
- Crop Diseases & Treatments (Global & Rwanda)
- Livestock Health & Management (Global & Rwanda)
- Farming Techniques (Global & Rwanda)
- Agricultural Challenges & Solutions (Global & Rwanda)
- Agribusiness & Markets (Global & Rwanda)
- Agricultural Research & Innovations (Global & Rwanda)
- Career & Education Guidance (Global & Rwanda)

Rules for Your Responses:
- Always prioritize factual accuracy.
- If you cannot find a definitive answer, politely tell the user you could not find the information.
- Be concise, clear, and easy to understand.
- Always maintain a respectful and professional tone.
- For questions not related to Agriculture/Livestock, politely state: "I am specialized only in Agriculture and Livestock. I cannot answer questions about other topics."
`;
}

// ==========================================================
// AI CALL — Unified with fallbacks
// ==========================================================
async function callAI(systemPrompt, userMessage, history) {
  // Build messages
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
  messages.push({ role: 'user', content: userMessage });

  // Try Groq first
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const groqModels = [
      'llama-3.1-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768'
    ];
    for (const model of groqModels) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 1024,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          return data.choices[0].message.content;
        } else {
          const errorText = await response.text();
          console.warn(`Groq model ${model} failed (${response.status}):`, errorText);
        }
      } catch (err) {
        console.warn(`Groq model ${model} error:`, err.message);
      }
    }
  }

  // Fallback to Gemini
  const geminiKey = process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    const geminiModels = ['gemini-1.5-flash', 'gemini-1.5-pro'];
    for (const model of geminiModels) {
      try {
        const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: conversationText }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
            }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          return data.candidates[0].content.parts[0].text;
        } else {
          const errorText = await response.text();
          console.warn(`Gemini model ${model} failed (${response.status}):`, errorText);
        }
      } catch (err) {
        console.warn(`Gemini model ${model} error:`, err.message);
      }
    }
  }

  // Ultimate fallback
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
