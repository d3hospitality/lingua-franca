export default async function handler(req, res) {
  // CORS — allow Even Hub webview
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { audio, language } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'Missing audio data' });
    }

    // Decode base64 PCM → WAV
    const pcmBuffer = Buffer.from(audio, 'base64');
    const wavHeader = createWavHeader(pcmBuffer.length);
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

    // ── DEEPGRAM first (faster, native language lock) ──
    if (process.env.DEEPGRAM_API_KEY) {
      try {
        const params = new URLSearchParams({
          model: 'nova-2',
          smart_format: 'true',
        });
        if (language) {
          params.set('language', language);
        } else {
          params.set('detect_language', 'true');
        }

        const dgResp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'audio/wav',
          },
          body: wavBuffer,
        });

        if (dgResp.ok) {
          const data = await dgResp.json();
          const alt = data?.results?.channels?.[0]?.alternatives?.[0];
          const detected = data?.results?.channels?.[0]?.detected_language;
          const text = (alt?.transcript || '').trim();
          if (text) {
            return res.status(200).json({
              text,
              confidence: alt?.confidence || 0,
              language: language || detected || 'unknown',
              engine: 'deepgram',
            });
          }
        } else {
          const err = await dgResp.text();
          console.error('Deepgram failed:', dgResp.status, err.slice(0, 200));
        }
      } catch (err) {
        console.error('Deepgram error:', err.message || err);
      }
    }

    // ── OPENAI fallback (gpt-4o-transcribe) ──
    if (process.env.OPENAI_API_KEY) {
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

      const filePart = [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n`,
        `Content-Type: audio/wav\r\n\r\n`,
      ];
      const modelPart = [
        `\r\n--${boundary}\r\n`,
        `Content-Disposition: form-data; name="model"\r\n\r\n`,
        `gpt-4o-transcribe`,
      ];
      const langPart = language ? [
        `\r\n--${boundary}\r\n`,
        `Content-Disposition: form-data; name="language"\r\n\r\n`,
        language,
      ] : [];
      const endPart = [`\r\n--${boundary}--\r\n`];

      const formBody = Buffer.concat([
        Buffer.from(filePart.join('')),
        wavBuffer,
        Buffer.from(modelPart.join('')),
        Buffer.from(langPart.join('')),
        Buffer.from(endPart.join('')),
      ]);

      const oaiResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: formBody,
      });

      if (oaiResp.ok) {
        const data = await oaiResp.json();
        return res.status(200).json({
          text: (data.text || '').trim(),
          language: language || 'auto',
          engine: 'openai',
        });
      } else {
        const err = await oaiResp.text();
        console.error('OpenAI failed:', oaiResp.status, err.slice(0, 200));
      }
    }

    return res.status(500).json({ error: 'Both engines failed or no API keys configured' });

  } catch (err) {
    console.error('Transcribe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function createWavHeader(dataLength) {
  const header = Buffer.alloc(44);
  const sampleRate = 16000;
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}
