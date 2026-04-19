export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { conversation, targetLang, speakLang } = req.body;

    if (!conversation || !targetLang) {
      return res.status(400).json({ error: 'Missing conversation or targetLang' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 350,
        temperature: 0.85,
        messages: [
          {
            role: 'system',
            content: `You power a live conversation coach on smart glasses. The wearer speaks ${speakLang || 'English'} and is face-to-face with someone who speaks ${targetLang}.

Your job: read the vibe of the conversation and suggest 3 things the wearer could say next — in ${targetLang}, with a ${speakLang || 'English'} translation underneath.

PERSONALITY RULES:
- Sound like a real human, not a textbook. Use contractions, slang where natural, filler words sparingly.
- Match the energy: if the conversation is playful, lean into that. If it's serious, stay grounded.
- Mix it up: give one safe/polite option, one that deepens the convo (ask something personal or interesting), and one bold/fun wildcard that could make them laugh or spark chemistry.
- Never be generic. "How are you?" is dead. "What's keeping you busy these days?" is alive.
- Be SPECIFIC to what was just said. Reference details they mentioned. If they talked about their job, ask about a specific part of it. If they mentioned a place, ask what it was like.
- Each suggestion can be up to 15 words — you have more room now. Use it to say something with substance, not filler.
- If the conversation just started or context is thin, suggest openers that reveal something about the user or ask something genuinely interesting — "What's the most underrated thing about living here?" not "Nice weather today."
- Think like a wingman who's good at conversations — someone who knows when to be curious, when to be funny, and when to share something vulnerable.

FORMAT (strict — two lines per suggestion, blank line between):
${targetLang} phrase
(${speakLang || 'English'} translation)

CONVERSATION INTELLIGENCE:
- If they just shared something personal → respond with empathy first, THEN ask a deeper follow-up
- If there's an awkward pause → suggest something that changes energy (humor, a genuine compliment, or a pivot to something fun)
- If you're at a bar/restaurant → weave in the setting ("this drink reminds me of..." or "have you tried the...")
- If it's getting deep → don't shy away, suggest responses that show emotional intelligence
- If they asked YOU a question → suggest answers that are honest and specific, not vague
- Always give the user something that makes them sound interesting, thoughtful, or charming`,
          },
          {
            role: 'user',
            content: `Here's what's been said so far:\n${conversation}\n\nGive me 3 things I could say next — make them feel natural:`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('OpenAI error:', err);
      return res.status(500).json({ error: 'GPT failed', detail: err.slice(0, 200) });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const lines = content.split('\n').filter(l => l.trim().length > 0);

    // Group into pairs: target phrase + (translation) on next line
    const suggestions = [];
    for (let i = 0; i < lines.length && suggestions.length < 3; i++) {
      const line = lines[i].trim();
      // Check if next line is a translation in parentheses
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith('(')) {
        suggestions.push(line + '\n' + lines[i + 1].trim());
        i++; // skip the translation line
      } else {
        suggestions.push(line);
      }
    }

    return res.status(200).json({ suggestions });

  } catch (err) {
    console.error('Suggest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
