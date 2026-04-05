export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, imageBase64, mediaType, prompt, predictionId } = req.body;
  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
  const REPLICATE_KEY = process.env.REPLICATE_API_TOKEN;

  try {

    if (action === 'identify') {
      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 }
              },
              {
                type: 'text',
                text: `You are a wildlife biologist and fantasy game designer. Analyze this image.

If no wild animal is visible (human, pet, object, landscape only), return exactly: {"found":false}

If a wild animal is visible, return ONLY this JSON with no markdown or explanation:
{
  "found": true,
  "commonName": "Red Fox",
  "latinName": "Vulpes vulpes",
  "rarity": 2,
  "atk": 78,
  "def": 45,
  "spd": 92,
  "abilities": ["Ember Trail", "Cunning Strike", "Night Sense"],
  "spiritName": "Vulpes Ignis",
  "lore": "Its russet coat holds the memory of autumn fires, leaving warmth in the coldest snow.",
  "imagePrompt": "A red fox, fantasy spirit form, bioluminescent amber glowing patterns on fur, magical runes etched into body, ethereal wisps of orange light, realistic anatomy, dark mystical forest background, cinematic lighting, detailed painterly illustration, 4k"
}

Rules:
- rarity: 1=Common(pigeons/sparrows/squirrels), 2=Uncommon, 3=Rare, 4=Epic, 5=Mythic(endangered)
- stats 40-99 based on real animal traits
- spiritName = real Latin genus + one of: Ignis/Umbra/Spectra/Fulgur/Aether/Noctis/Solaris/Verdant
- abilities count equals rarity (1 ability if rarity 1, up to 4-5 if rarity 4-5)
- imagePrompt should describe the specific animal with magical/bioluminescent elements`
              }
            ]
          }]
        })
      });

      if (!claudeResp.ok) {
        const err = await claudeResp.json();
        return res.status(500).json({ error: err.error?.message || 'Claude API error ' + claudeResp.status });
      }

      const data = await claudeResp.json();
      const text = data.content.find(b => b.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const result = JSON.parse(clean);
      return res.status(200).json(result);
    }

    if (action === 'generate_image') {
      const r = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${REPLICATE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { prompt, num_outputs: 1, aspect_ratio: '1:1', output_quality: 80 } })
      });
      const d = await r.json();
      if (!r.ok) return res.status(500).json({ error: 'Replicate error' });
      return res.status(200).json({ predictionId: d.id });
    }

    if (action === 'poll_image') {
      const r = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_KEY}` }
      });
      const d = await r.json();
      return res.status(200).json({ status: d.status, output: d.output });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
