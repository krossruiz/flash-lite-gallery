import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static assets (client)
app.use(express.static(__dirname));

// Expose the images directory statically
const imagesDir = path.join(__dirname, 'galleryImages');
app.use('/galleryImages', express.static(imagesDir));

// Serve gallery at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'gallery.html'));
});

// List images endpoint
app.get('/api/images', async (req, res) => {
  try {
    const files = await fs.promises.readdir(imagesDir);
    const imageFiles = files.filter((f) => /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.bmp)$/i.test(f));
    const urls = imageFiles.map((f) => `/galleryImages/${encodeURIComponent(f)}`);
    res.json({ images: urls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read images' });
  }
});

// Generate code via Gemini Flash Lite
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, images } = req.body || {};
    if (!prompt || !Array.isArray(images)) {
      return res.status(400).json({ error: 'Missing prompt or images' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY in environment' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const tools = [ { googleSearch: {} } ];
    const config = { thinkingConfig: { thinkingBudget: 24576 }, tools };
    const model = 'gemini-2.5-flash';


    // Instruct model to return only HTML+CSS+JS inside a single HTML document body
    const systemInstruction = `You are generating self-contained web UI code for a gallery website.
Return ONLY a COMPLETE raw HTML snippet (you may include <style> and <script>) that renders directly inside a <div id="output"></div> container.
Do NOT return Markdown or triple backticks. Do NOT add explanations or prose.
Use the provided image URLs exactly as they are. Do not fetch external libraries.
Do not include <html>, <head>, or <body> tags. Keep JS inline in a <script> tag. Don't use CSS. Don't use any <style> tags. Do not modify the html elements' style using css in the javascript code either. Don't make assumptions about the layout of the html, just that you're injecting code into a div.
The user instruction is: ${prompt}`;

    const contents = [
      {
        role: 'user',
        parts: [
          { text: systemInstruction },
          { text: `Image URLs (JSON array): ${JSON.stringify(images)}` },
        ],
      },
    ];

    const stream = await ai.models.generateContentStream({ model, config, contents });
    let generated = '';
    for await (const chunk of stream) {
      if (chunk?.text) generated += chunk.text;
    }

    // Normalize: extract from Markdown code fences if present, then strip outer html/head/body
    const extractFromFences = (text) => {
      const fence = text.match(/```[a-zA-Z]*\s*\n([\s\S]*?)\n```/);
      if (fence && fence[1]) return fence[1];
      const fence2 = text.match(/```[a-zA-Z]*\s*\r?\n?([\s\S]*?)```/);
      if (fence2 && fence2[1]) return fence2[1];
      return text.replace(/^```[a-zA-Z]*\s*/g, '').replace(/```\s*$/g, '');
    };
    const stripOuterTags = (html) => html
      .replace(/<\/?html[^>]*>/gi, '')
      .replace(/<\/?head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<\/?body[^>]*>/gi, '');

    const cleaned = stripOuterTags(extractFromFences(generated)).trim();
    res.json({ html: cleaned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Generation failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


