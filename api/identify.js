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
      // iNaturalist identifies species — completely FREE
      const binaryStr = atob(imageBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: mediaType });
      const formData = new FormData();
      formData.append('image', blob, 'photo.jpg');

      const inatResp = await fetch('https://api.inaturalist.org/v1/computervision/score_image', {
        method: 'POST',
        body: formData
      });

      if (!inatResp.ok) {
        return res.status(500).json({ error: 'iNaturalist error ' + inatResp.status });
      }

      const inatData = await inatResp.json();
      const results = inatData.results || [];
      if (!results.length) return res.status(200).json({ found: false });

      const top = results[0];
      const taxon = top.taxon || {};
      const commonName = taxon.preferred_common_name || taxon.name || 'Unknown Species';
      const latinName = taxon.name || '';
      const obsCount = taxon.observations_count || 0;
      const iconicGroup = taxon.iconic_taxon_name || 'Unknown';

      let rarity;
      if (obsCount > 500000) rarity = 1;
      else if (obsCount > 100000) rarity = 2;
      else if (obsCount > 20000) rarity = 3;
      else if (obsCount > 3000) rarity = 4;
      else rarity = 5;

      const cs = taxon.conservation_status?.status_name?.toLowerCase() || '';
      if (cs.includes('endangered') || cs.includes('critical')) rarity = Math.min(5, rarity + 1);

      // Claude Haiku generates lore + stats — costs ~$0.0003 per call
      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Fantasy game designer. Animal: ${commonName} (${latinName}), group: ${iconicGroup}, rarity: ${rarity}/5.
Respond ONLY with JSON:
{"spiritName":"Vulpes Ignis","atk":78,"def":45,"spd":92,"abilities":["Ember Trail","Cunning Strike"],"lore":"One vivid mystical sentence.","imagePrompt":"A ${commonName}, fantasy spirit form, bioluminescent glowing patterns on body, magical runes, ethereal light wisps, dark forest, cinematic painterly illustration 4k"}
spiritName=Latin genus + Ignis/Umbra/Spectra/Fulgur/Aether/Noctis. Stats 40-99 from real traits.`
          }]
        })
      });

      let gameData;
      if (claudeResp.ok) {
        const cd = await claudeResp.json();
        const text = cd.content.find(b => b.type === 'text')?.text || '';
        try { gameData = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch(e) {}
      }

      if (!gameData) {
        const genus = latinName.split(' ')[0] || 'Spiritus';
        const sfx = ['Umbra','Ignis','Spectra','Fulgur','Aether','Noctis'];
        const pools = {
          Aves:['Aerial Strike','Wind Ride','Keen Eye','Storm Call'],
          Mammalia:['Pack Bond','Night Sense','Primal Roar','Endurance'],
          Reptilia:['Scale Guard','Cold Patience','Camouflage','Venom Fang'],
          Amphibia:['Regeneration','Void Breath','Skin Pulse','Mist Form'],
          Insecta:['Swarm Mind','Metamorphosis','Pheromone','Compound Eye'],
          default:['Spirit Pulse','Ancient Bond','Aura Burst','Elemental Touch']
        };
        const pool = pools[iconicGroup] || pools.default;
        gameData = {
          spiritName: genus + ' ' + sfx[Math.floor(Math.random()*sfx.length)],
          atk: 40+rarity*10, def: 40+rarity*8, spd: 40+rarity*9,
          abilities: pool.slice(0, Math.min(rarity, pool.length)),
          lore: `A ${rarity>=4?'legendary':'rare'} spirit born from the ancient essence of the ${commonName}.`,
          imagePrompt: `A ${commonName}, fantasy spirit form, bioluminescent glowing patterns, magical runes, ethereal light wisps, dark mystical forest, cinematic lighting, painterly illustration, 4k`
        };
      }

      return res.status(200).json({ found: true, commonName, latinName, rarity, ...gameData });
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
