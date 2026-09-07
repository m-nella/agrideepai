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

// ... middleware setup (same as before) ...

// --- Gemini with robust fallback ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAMES = [
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
      console.log(`✅ Using Gemini model: ${name}`);
      activeModel = model;
      return model;
    } catch (e) {
      console.warn(`⚠️ Model ${name} unavailable, trying next...`);
    }
  }
  // Last resort: try the first one (will throw a clear error)
  activeModel = genAI.getGenerativeModel({ model: MODEL_NAMES[0] });
  return activeModel;
}
// ... rest unchanged ...
