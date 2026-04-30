const { generateCompilerResult, readBody } = require('../_lib/compiler');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);
    const prompt = body.prompt || req.query.prompt || '';

    if (!String(prompt).trim()) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const result = await generateCompilerResult(prompt, {
      model: req.body?.model || req.query.model,
      maxTokens: Number.parseInt(process.env.GROQ_MAX_TOKENS || '1600', 10)
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};