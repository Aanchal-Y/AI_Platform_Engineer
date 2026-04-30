const { generateCompilerResult, readBody } = require('../_lib/compiler');
const { EVAL_CASES } = require('../_lib/evalCases');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);
    const fastMode = body.fast === true || req.query.fast === '1';
    const selectedCases = fastMode ? EVAL_CASES.slice(0, 10) : EVAL_CASES;
    const results = [];

    for (const testCase of selectedCases) {
      const startedAt = Date.now();
      try {
        const compiled = await generateCompilerResult(testCase.prompt, { maxTokens: fastMode ? 900 : 1600 });
        const success = compiled.validation?.status !== 'warning' || (compiled.validation?.errors || []).length === 0;

        results.push({
          testId: testCase.id,
          prompt: testCase.prompt,
          success,
          errors: compiled.validation?.issues_found || [],
          latency: Date.now() - startedAt,
          apiCalls: compiled.metrics?.api_calls ?? 1
        });
      } catch (error) {
        results.push({
          testId: testCase.id,
          prompt: testCase.prompt,
          success: false,
          error: error.message,
          latency: Date.now() - startedAt,
          apiCalls: 0
        });
      }

      if (fastMode) {
        await delay(50);
      }
    }

    const totalTests = results.length;
    const stats = {
      totalTests,
      successCount: results.filter((result) => result.success).length,
      avgLatency: Math.round(results.reduce((sum, result) => sum + result.latency, 0) / totalTests),
      avgApiCalls: (results.reduce((sum, result) => sum + result.apiCalls, 0) / totalTests).toFixed(2),
      errorCount: results.filter((result) => !result.success).length
    };

    res.status(200).json({ results, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};