import express from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_PROMPT = text => `You are a precision kitchen design data extraction specialist. Analyse this kitchen plan document and return ONLY a valid JSON object — no markdown, no code fences, no extra commentary, just raw JSON.

Extract every piece of structured data present. Be thorough and precise. If a field is not found, use "" for strings and [] for arrays.

DOCUMENT TEXT:
${text}

RETURN THIS EXACT JSON STRUCTURE:
{
  "project_info": {
    "developer": "", "location": "", "model": "", "plot": "",
    "designer": "", "revision": "", "date": "", "drawing_number": ""
  },
  "dimensions": {
    "total_length": "", "total_depth": "", "total_height": "",
    "worktop_height": "", "key_measurements": []
  },
  "base_units": [
    {"code":"","description":"","width":"","height":"","depth":"","quantity":"1","notes":""}
  ],
  "wall_units": [
    {"code":"","description":"","width":"","height":"","depth":"","quantity":"1","notes":""}
  ],
  "tall_units": [
    {"code":"","description":"","width":"","height":"","depth":"","quantity":"1","notes":""}
  ],
  "appliances": [
    {"code":"","type":"","description":"","brand":"","width":"","height":"","depth":"","quantity":"1","notes":""}
  ],
  "worktops": [
    {"material":"","colour":"","length":"","depth":"","thickness":"","quantity":"1","notes":""}
  ],
  "sinks": [
    {"code":"","type":"","description":"","width":"","notes":""}
  ],
  "taps": [
    {"code":"","description":"","finish":"","notes":""}
  ],
  "handles": [
    {"code":"","description":"","finish":"","quantity":""}
  ],
  "lighting": [
    {"code":"","type":"","location":"","quantity":""}
  ],
  "accessories": [
    {"code":"","item":"","quantity":"","notes":""}
  ],
  "special_notes": [],
  "summary": ""
}`;

app.post('/api/extract', upload.single('pdf'), async (req, res) => {
  const apiKey = req.body.apiKey;

  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded.' });
  if (!apiKey || apiKey.length < 16) return res.status(400).json({ error: 'Valid Groq API key required.' });

  try {
    const parsed = await pdfParse(req.file.buffer);
    const text = parsed.text.substring(0, 7000);
    const pages = parsed.numpages;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 4096,
        temperature: 0.1,
        messages: [{ role: 'user', content: GROQ_PROMPT(text) }]
      })
    });

    const groqBody = await groqRes.text();

    if (!groqRes.ok) {
      let msg = `Groq API error ${groqRes.status}`;
      try { msg = JSON.parse(groqBody).error?.message || msg; } catch {}
      if (groqRes.status === 401) msg = 'Invalid API key — get a free one at console.groq.com';
      if (groqRes.status === 429) msg = 'Rate limited — wait a moment and try again';
      return res.status(groqRes.status).json({ error: msg });
    }

    const groqData = JSON.parse(groqBody);
    let jsonTxt = groqData.choices?.[0]?.message?.content?.trim() || '';
    jsonTxt = jsonTxt.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = jsonTxt.match(/\{[\s\S]*\}/);
    if (match) jsonTxt = match[0];

    const extracted = JSON.parse(jsonTxt);
    res.json({ data: extracted, pages, chars: text.length });

  } catch (err) {
    console.error('[extract error]', err.message);
    res.status(500).json({ error: err.message || 'Extraction failed' });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`\n  ┌─────────────────────────────────────────┐`);
  console.log(`  │  🏠 Kitchen Plan Extractor              │`);
  console.log(`  │  Running at http://localhost:${PORT}       │`);
  console.log(`  └─────────────────────────────────────────┘\n`);
});
