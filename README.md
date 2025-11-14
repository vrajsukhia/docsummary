# Document Summary Assistant

AI-powered assistant that ingests PDFs or scanned images, extracts their text, and produces concise summaries, key points, and actionable improvement suggestions in seconds.

## Features at a Glance
- **Drag-and-drop uploads** for PDFs and common image formats (JPG, PNG).
- **Automated text extraction** via `pdf-parse` for digital PDFs and `tesseract.js` OCR for scans.
- **Gemini-powered analysis** with short/medium/long summary modes, bullet key points, highlights, and improvement suggestions.
- **Responsive React UI** with live previews, loading states, and document insights.
- **API-first backend** ready for deployment on Render, Railway, Vercel, or any Node-friendly host, now leveraging MongoDB Atlas for ephemeral upload storage.

## Architecture & Workflow
1. **Upload & Validation** – `multer` stores the file in memory (50 MB max) before persisting it briefly inside MongoDB Atlas, while enforcing PDF/image types.
2. **Text Extraction** – PDFs pass through `pdf-parse`; images flow through `tesseract.js` (language configurable via `OCR_LANG`).
3. **Normalization & Chunking** – whitespace is condensed, text is sliced into `CHUNK_SIZE` batches, and large documents run through Gemini in parallel before being stitched back together.
4. **AI Analysis** – Three parallel Gemini prompts create: (a) prose summary tuned to the selected length, (b) 5‑7 bullet key points, (c) three improvement suggestions.
5. **Highlight Derivation** – Top sentences from the summary surface as "Highlights" for quick scanning.
6. **Response Packaging** – The API returns the analysis bundle plus file metadata and character counts. The React client renders highlight chips, bullet lists, improvement callouts, and document insights.

## Tech Stack
- **Frontend:** React 18 + Vite, Axios, modern CSS.
- **Backend:** Node 18+, Express 5, Multer, pdf-parse, Tesseract.js, @google/generative-ai, MongoDB Atlas.
- **AI:** Google Gemini 1.5 Flash (configurable).

## Getting Started
### Prerequisites
- Node.js 18+
- Gemini API key (Google AI Studio)

### Environment Variables
Create `backend/.env`:
```ini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash-latest
PORT=8000
MAX_INPUT_CHARS=20000
OCR_LANG=eng
CHUNK_SIZE=4000
MAX_CHUNK_CONCURRENCY=3
GEMINI_RETRY_LIMIT=3
GEMINI_RETRY_DELAY_MS=2000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net
MONGODB_DB=docsummary (optional)
MONGODB_COLLECTION=uploads (optional)
```

Create `frontend/.env`:
```ini
VITE_API_URL=http://localhost:8000
```

### Install & Run
```powershell
# Backend
cd backend
npm install
npm start

# Frontend (new terminal)
cd ../frontend
npm install
npm run dev -- --host
```
Visit `http://localhost:5173` and drop a document.

## API Contract
`POST /upload`
- **Body:** `multipart/form-data` with `file` (PDF/JPG/PNG) and `length` (`short` | `medium` | `long`).
- **Response:**
```json
{
  "success": true,
  "data": {
    "summary": "...",
    "keyPoints": ["..."],
    "improvementSuggestions": ["..."],
    "highlights": ["..."],
    "file": {"name": "report.pdf", "size": 123456, "mime": "application/pdf"},
    "stats": {"extractedCharacters": 8421, "summaryCharacters": 730},
    "summaryLength": "medium",
    "truncated": false
  }
}
```
Errors follow `{ success: false, error: "message" }`.

## Deployment Notes
- **Frontend:** Deploy via Netlify/Vercel. Point `VITE_API_URL` to your hosted backend URL.
- **Backend:** Any Node host works. Remember to add `GEMINI_API_KEY`, `MONGODB_URI`, and increase `MAX_INPUT_CHARS` only if your quota allows.
- Use HTTPS for both tiers before sharing the public link.

## Validation
- Frontend: `npm run build` to ensure production bundles succeed.
- Backend: `npm start` bootstraps Express and validates environment loading.

## Approach (197 words)
I treated this assessment like a production integration between document-processing services and a modern AI model. First, I locked the contract: a single `/upload` endpoint accepts PDFs or scanned images, fans out to the correct extractor, normalizes text, and caps payload size for Gemini. The analysis step runs three prompts in parallel—summary, key points, and improvement suggestions—so latency stays low while coverage stays rich. Highlights are derived deterministically from the returned summary to guarantee a stable UX even if the model output varies slightly. On the client, I focused on immediate clarity: the drop zone previews images, length controls sit next to the primary action, and results render in stacked sections (Summary, Highlights, Key Points, Suggestions, Insights) with chips and grids for scannability on desktop or mobile. I added resilient error handling, loading indicators, and metadata readouts so users trust every response. Documentation doubles as a playbook: environment setup, API contract, deployment steps, and the reasoning behind constraints like `MAX_INPUT_CHARS`. The result is a lightweight but production-ready assistant that you can deploy to Netlify + Render (or similar) in minutes while staying within Gemini’s free-tier limits.
