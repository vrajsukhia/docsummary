require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 8000;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_CANDIDATES = Array.from(new Set([
  process.env.GEMINI_MODEL,
  'gemini-2.5-pro',
  'gemini-2.5-flash'
])).filter(Boolean);

let cachedModelId = null;
let cachedModel = null;

const MAX_INPUT_CHARS = parseInt(process.env.MAX_INPUT_CHARS || '20000', 10);
const OCR_LANG = process.env.OCR_LANG || 'eng';
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '4000', 10);
const MAX_CHUNK_CONCURRENCY = parseInt(process.env.MAX_CHUNK_CONCURRENCY || '3', 10);
const GEMINI_RETRY_LIMIT = parseInt(process.env.GEMINI_RETRY_LIMIT || '3', 10);
const GEMINI_RETRY_DELAY_MS = parseInt(process.env.GEMINI_RETRY_DELAY_MS || '2000', 10);

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|png|jpg|jpeg/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only PDF and image files are allowed'));
  },
});

// --- Helper Functions ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Extract text from PDF
async function extractTextFromPDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const originalWarn = console.warn;
  console.warn = (msg, ...rest) => {
    if (typeof msg === 'string' && msg.includes('TT: undefined function')) return;
    originalWarn(msg, ...rest);
  };
  try {
    const { text } = await pdfParse(buffer);
    return text;
  } finally {
    console.warn = originalWarn;
  }
}

// Extract text from image
async function extractTextFromImage(filePath) {
  const { data: { text } } = await Tesseract.recognize(filePath, OCR_LANG);
  return text;
}

// Clean and trim raw text before sending to Gemini
function prepareTextPayload(rawText = '') {
  const condensed = rawText.replace(/\s+/g, ' ').trim();
  if (condensed.length <= MAX_INPUT_CHARS) return condensed;
  return `${condensed.slice(0, MAX_INPUT_CHARS)}...`;
}

function parseBullets(block = '') {
  return block
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d\.\)\s]+/, '').trim())
    .filter(Boolean);
}

function deriveHighlights(summaryText = '', count = 3) {
  const sentences = summaryText
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]/g) || [];
  return sentences.slice(0, count).map((s) => s.trim());
}

async function callModel(modelId, prompt) {
  let lastError;
  for (let attempt = 0; attempt < GEMINI_RETRY_LIMIT; attempt++) {
    try {
      const modelInstance = cachedModelId === modelId && cachedModel
        ? cachedModel
        : genAI.getGenerativeModel({ model: modelId });

      const { response } = await modelInstance.generateContent(prompt);

      if (cachedModelId !== modelId) {
        cachedModelId = modelId;
        cachedModel = modelInstance;
        console.log(`Gemini model in use: ${modelId}`);
      }

      return response.text().trim();
    } catch (error) {
      lastError = error;
      const isTransient = isRetryableError(error);
      if (!isTransient || attempt === GEMINI_RETRY_LIMIT - 1) throw error;
      await sleep(getRetryDelayMs(error, attempt));
    }
  }
  throw lastError || new Error(`Gemini model ${modelId} failed`);
}

async function askGemini(prompt) {
  if (!MODEL_CANDIDATES.length) {
    throw new Error('No Gemini models configured. Set GEMINI_MODEL or use the default list.');
  }

  let lastError;
  for (const candidate of MODEL_CANDIDATES) {
    try {
      return await callModel(candidate, prompt);
    } catch (error) {
      lastError = error;
      const isMissingModel = error?.status === 404 || /not found/i.test(error?.message || '');
      const isTransient = isRetryableError(error);
      if (!isMissingModel && !isTransient) throw error;
      console.warn(`Gemini model ${candidate} unavailable. Trying next fallback...`);
    }
  }

  throw lastError || new Error('All configured Gemini models failed.');
}

function isRetryableError(error) {
  if (!error) return false;
  const retryableStatuses = [429, 503];
  if (retryableStatuses.includes(Number(error.status))) return true;
  const message = error?.message || '';
  return /overloaded|service unavailable|timeout|quota exceeded|retry/i.test(message);
}

function getRetryDelayMs(error, attempt) {
  const defaultDelay = GEMINI_RETRY_DELAY_MS * (attempt + 1);
  if (!error) return defaultDelay;
  const fromMessage = parseDelayFromMessage(error.message);
  const fromDetails = parseDelayFromDetails(error.errorDetails);
  const delay = Math.max(defaultDelay, fromMessage || 0, fromDetails || 0);
  return delay || defaultDelay;
}

function parseDelayFromMessage(message = '') {
  const match = message.match(/retry in\s+([0-9.]+)s/i);
  if (match) {
    const seconds = parseFloat(match[1]);
    if (!Number.isNaN(seconds)) return seconds * 1000;
  }
  return 0;
}

function parseDelayFromDetails(details) {
  if (!Array.isArray(details)) return 0;
  for (const detail of details) {
    if (detail?.retryDelay) {
      if (typeof detail.retryDelay === 'string' && detail.retryDelay.endsWith('s')) {
        const seconds = parseFloat(detail.retryDelay.replace('s', ''));
        if (!Number.isNaN(seconds)) return seconds * 1000;
      }
      if (typeof detail.retryDelay === 'number') {
        return detail.retryDelay * 1000;
      }
    }
  }
  return 0;
}

function splitIntoChunks(text, chunkSize = CHUNK_SIZE) {
  if (!text) return [];
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

async function mapWithConcurrency(items, mapper, limit = MAX_CHUNK_CONCURRENCY) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  const workers = Array(workerCount).fill(0).map(worker);
  await Promise.all(workers);
  return results;
}

async function runFullAnalysis(text, length, extraMeta = {}) {
  const payload = prepareTextPayload(text);
  const lengthDirectives = {
    short: 'Limit the summary to 3-4 concise sentences.',
    medium: 'Provide a balanced summary in 5-8 sentences.',
    long: 'Provide a detailed three-paragraph summary with transitions.',
  };

  const summaryPrompt = `You are an expert technical editor. ${lengthDirectives[length] || ''}\nHighlight the main intent, supporting arguments, and any calls to action. Use clear prose.\nSOURCE:\n${payload}`;

  const keyPointPrompt = `Extract the most critical ideas from the following document.\nReturn 5-7 bullet points. Each bullet should be one sentence and stand alone.\nSOURCE:\n${payload}`;

  const improvementPrompt = `Act as a senior reviewer. Suggest three actionable improvements to make this document clearer, more persuasive, or more complete. Return them as bullet points.\nSOURCE:\n${payload}`;

  const [summary, keyPointBlock, suggestionsBlock] = await Promise.all([
    askGemini(summaryPrompt),
    askGemini(keyPointPrompt),
    askGemini(improvementPrompt),
  ]);

  const keyPoints = parseBullets(keyPointBlock);
  const improvementSuggestions = parseBullets(suggestionsBlock);
  const highlights = deriveHighlights(summary);

  return {
    summary,
    keyPoints,
    improvementSuggestions,
    highlights,
    truncated: extraMeta.truncated ?? payload.length < text.length,
  };
}

async function generateAnalysis(text, length = 'medium') {
  const sanitizedText = text.replace(/\s+/g, ' ').trim();
  const chunks = splitIntoChunks(sanitizedText, CHUNK_SIZE);
  if (chunks.length === 0) return runFullAnalysis('', length);

  if (chunks.length === 1) {
    return runFullAnalysis(chunks[0], length, { truncated: chunks[0].length < sanitizedText.length });
  }

  const chunkSummaries = await mapWithConcurrency(chunks, async (chunk, index) => {
    const chunkPrompt = `You will help summarize a large document chunk-by-chunk.\nChunk ${index + 1} of ${chunks.length}.\nSummarize this chunk in 3 crisp sentences focusing on unique facts.\nCHUNK:\n${chunk}`;
    return askGemini(chunkPrompt);
  }, MAX_CHUNK_CONCURRENCY);

  const aggregatePayload = chunkSummaries
    .map((chunkSummary, idx) => `Chunk ${idx + 1}: ${chunkSummary}`)
    .join('\n');

  const aggregateAnalysis = await runFullAnalysis(aggregatePayload, length, { truncated: false });
  return {
    ...aggregateAnalysis,
    chunkSummaries,
    chunkCount: chunks.length,
  };
}

// Generate summary with Gemini AI
// --- Routes ---

app.get('/', (req, res) => res.send('Document Summary Assistant API running'));

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const summaryLength = req.body.length || 'medium';
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let extractedText = '';
    if (ext === '.pdf') extractedText = await extractTextFromPDF(filePath);
    else extractedText = await extractTextFromImage(filePath);

    if (!extractedText || !extractedText.trim()) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'No text could be extracted from the document' });
    }

    let analysis;
    try {
      analysis = await generateAnalysis(extractedText, summaryLength);
    } catch (aiError) {
      fs.unlinkSync(filePath);
      // Only respond after all fallback attempts fail
      return res.status(500).json({ success: false, error: aiError.message });
    }

    fs.unlinkSync(filePath); // clean up uploaded file

    res.json({
      success: true,
      data: {
        ...analysis,
        file: {
          name: req.file.originalname,
          size: req.file.size,
          mime: req.file.mimetype,
        },
        stats: {
          extractedCharacters: extractedText.length,
          summaryCharacters: analysis.summary.length,
        },
        summaryLength,
      },
    });

  } catch (e) {
    console.error(e);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Start server
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
