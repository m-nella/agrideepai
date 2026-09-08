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

// ... (middleware, supabase, resend, etc. same as before)

// --- Gemini with reliable fallback ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// First try the most widely available models
const MODEL_CANDIDATES = [
  'gemini-1.5-flash',
  'gemini-pro',
  'gemini-1.0-pro'
];

let activeModel = null;

function getModel() {
  if (activeModel) return activeModel;
  for (const name of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: name });
      // Test with a minimal request (optional)
      console.log(`✅ Using Gemini model: ${name}`);
      activeModel = model;
      return model;
    } catch (e) {
      console.warn(`⚠️ Model ${name} unavailable: ${e.message}`);
    }
  }
  // Fallback to the first one (will throw a clear error if still failing)
  activeModel = genAI.getGenerativeModel({ model: MODEL_CANDIDATES[0] });
  return activeModel;
}

// ... (rest of server.js unchanged – keep all routes, auth, chat, share, etc.)
