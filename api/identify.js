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
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: `You are a wildlife species identifier. Analyze this image and respond ONLY with a valid JSON object, no markdown, no explanation.

If no wildlife animal is visible (or it's a human/domestic pet), return: {"found":false}

If wildlife is found, return:
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
  "lore": "Its russet coat holds the memory of autumn fires. Leaves a faint trail of warmth in deep snow.",
  "imagePrompt": "A red fox, fantasy spirit form, bioluminescent amber glowing patterns on fur, magical runes, ethereal wisps of light, dark mystical forest, cinematic lighting, detailed painterly illustration, 4k"
}

Rarity: 1=Common, 2=Uncommon, 3=Rare, 4=Epic, 5=Mythic(endangered)
Stats 40-99 based on real animal traits. spiritName = Latin genus + magical word (Ignis/Umbra/Spectra/Fulgur/Aether/Noctis).` }
            ]
          }]
        })
      });
      const data = await response.json();
      if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude error' });
      const text = data.content.find(b => b.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      return res.status(200).json(JSON.parse(clean));
    }

    if (action === 'generate_image') {
      const response = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${REPLICATE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { prompt, num_outputs: 1, aspect_ratio: '1:1', output_quality: 80 } })
      });
      const data = await response.json();
      if (!response.ok) return res.status(500).json({ error: 'Replicate error' });
      return res.status(200).json({ predictionId: data.id });
    }

    if (action === 'poll_image') {
      const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_KEY}` }
      });
      const data = await response.json();
      return res.status(200).json({ status: data.status, output: data.output });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
