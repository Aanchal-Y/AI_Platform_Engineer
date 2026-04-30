const express = require('express');
const router = express.Router();
const { runStage } = require('../services/llmService');
const { validate, autoRepair } = require('../utils/validator');
const { normalizeConfig } = require('../utils/normalizeConfig');
const { saveEvalResult, getEvalResults } = require('../utils/db');

const EVAL_CASE_TIMEOUT_MS = Number.parseInt(process.env.EVAL_CASE_TIMEOUT_MS || '60000', 10);
const EVAL_CASE_TIMEOUT_FAST_MS = Number.parseInt(process.env.EVAL_CASE_TIMEOUT_FAST_MS || '120000', 10);
const EVAL_DELAY_MS = Number.parseInt(process.env.EVAL_DELAY_MS || '500', 10);
const EVAL_DELAY_FAST_MS = Number.parseInt(process.env.EVAL_DELAY_FAST_MS || '800', 10);
const EVAL_MAX_CASES_FAST = Number.parseInt(process.env.EVAL_MAX_CASES_FAST || '20', 10);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveFastMode(req) {
  return req.body.fast === true || req.query.fast === '1' || process.env.EVAL_FAST_MODE === 'true';
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

const EVAL_CASES = [
  {
    id: 'r1',
    category: 'real',
    prompt: 'Build a CRM with login, contacts, dashboard, role-based access, and a premium plan with payments. Admins can see analytics.'
  },
  {
    id: 'r2',
    category: 'real',
    prompt: 'Create a task management app with teams, projects, tasks, comments, and notifications.'
  },
  {
    id: 'r3',
    category: 'real',
    prompt: 'Build a blogging platform where authors write posts, readers comment, and admins moderate content.'
  },
  {
    id: 'r4',
    category: 'real',
    prompt: 'Create a fitness tracker with workouts, exercises, progress charts, and social sharing among friends.'
  },
  {
    id: 'r5',
    category: 'real',
    prompt: 'Build a small e-commerce site with products, cart, checkout, order history, and seller dashboard.'
  },
  {
    id: 'r6',
    category: 'real',
    prompt: 'An internal HR portal: employee records, leave requests, payroll, and manager approvals.'
  },
  {
    id: 'r7',
    category: 'real',
    prompt: 'Recipe sharing app: users upload recipes, others rate and favorite, filters by dietary preference.'
  },
  {
    id: 'r8',
    category: 'real',
    prompt: 'SaaS billing dashboard: subscriptions, invoices, usage metering, and per-seat pricing tiers.'
  },
  {
    id: 'r9',
    category: 'real',
    prompt: 'Real estate listings: properties, search with filters, contact agent, schedule a tour.'
  },
  {
    id: 'r10',
    category: 'real',
    prompt: 'Customer support helpdesk: tickets, agent assignment, SLA tracking, and analytics dashboard for managers.'
  },
  {
    id: 'e1',
    category: 'edge',
    prompt: 'Make me an app'
  },
  {
    id: 'e2',
    category: 'edge',
    prompt: 'Something for productivity'
  },
  {
    id: 'e3',
    category: 'edge',
    prompt: 'Build a public forum with strict admin-only posting'
  },
  {
    id: 'e4',
    category: 'edge',
    prompt: 'A completely free service where every feature requires payment'
  },
  {
    id: 'e5',
    category: 'edge',
    prompt: 'I need users to log in'
  }
];

async function runEvalCase(testCase, fastMode) {
  const startTime = Date.now();
  const prompt = testCase.prompt;
  let apiCalls = 0;
  let success = false;
  let errors = [];

  try {
    if (fastMode) {
      const fastStage = await runStage('fast', prompt);
      apiCalls += fastStage.fallback ? 0 : 1;
      if (!fastStage.success) throw new Error('Fast stage failed');

      let finalConfig = normalizeConfig(fastStage.data, {}, {});
      let validationIssues = validate(finalConfig);

      if (validationIssues.length > 0) {
        const { config: autoRepaired } = autoRepair(finalConfig, validationIssues);
        finalConfig = autoRepaired;
        validationIssues = validate(finalConfig);
      }

      success = validationIssues.filter(i => i.sev === 'error').length === 0;
      errors = validationIssues;

      const latency = Date.now() - startTime;
      await saveEvalResult(testCase.id, prompt, { success, errors }, latency, apiCalls, success);

      return {
        testId: testCase.id,
        prompt: prompt,
        success: success,
        errors: errors,
        latency: latency,
        apiCalls: apiCalls
      };
    }

    // Stage 1
    const stage1 = await runStage('stage1', prompt);
    apiCalls += stage1.fallback ? 0 : 1;
    if (!stage1.success) throw new Error('Stage 1 failed');

    // Stage 2
    const stage2 = await runStage('stage2', prompt, { intent: stage1.data });
    apiCalls += stage2.fallback ? 0 : 1;
    if (!stage2.success) throw new Error('Stage 2 failed');

    // Stage 3
    const stage3 = await runStage('stage3', prompt, {
      intent: stage1.data,
      design: stage2.data
    });
    apiCalls += stage3.fallback ? 0 : 1;
    if (!stage3.success) throw new Error('Stage 3 failed');

    let finalConfig = normalizeConfig(stage3.data, stage1.data, stage2.data);
    let validationIssues = validate(finalConfig);

    // Auto-repair
    if (validationIssues.length > 0) {
      const { config: autoRepaired } = autoRepair(finalConfig, validationIssues);
      finalConfig = autoRepaired;
      validationIssues = validate(finalConfig);

      // LLM repair
      if (!fastMode && validationIssues.length > 0) {
        apiCalls++;
        const stage5 = await runStage('stage5', prompt, {
          config: finalConfig,
          issues: validationIssues
        });

        if (stage5.success && stage5.data) {
          finalConfig = normalizeConfig(stage5.data.config || stage5.data, stage1.data, stage2.data);
          validationIssues = validate(finalConfig);
        }
      }
    }

    success = validationIssues.filter(i => i.sev === 'error').length === 0;
    errors = validationIssues;

    const latency = Date.now() - startTime;
    await saveEvalResult(testCase.id, prompt, { success, errors }, latency, apiCalls, success);

    return {
      testId: testCase.id,
      prompt: prompt,
      success: success,
      errors: errors,
      latency: latency,
      apiCalls: apiCalls
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    await saveEvalResult(testCase.id, prompt, { error: error.message }, latency, apiCalls, false);
    return {
      testId: testCase.id,
      prompt: prompt,
      success: false,
      error: error.message,
      latency: latency,
      apiCalls: apiCalls
    };
  }
}

router.get('/cases', (req, res) => {
  res.json(EVAL_CASES);
});

router.post('/run/:testId', async (req, res) => {
  try {
    const testCase = EVAL_CASES.find(c => c.id === req.params.testId);
    if (!testCase) {
      return res.status(404).json({ error: 'Test case not found' });
    }

    const fastMode = resolveFastMode(req);
    const caseTimeoutMs = fastMode ? EVAL_CASE_TIMEOUT_FAST_MS : EVAL_CASE_TIMEOUT_MS;
    const startedAt = Date.now();
    try {
      const result = await withTimeout(
        runEvalCase(testCase, fastMode),
        caseTimeoutMs,
        `Eval ${testCase.id}`
      );
      res.json(result);
    } catch (error) {
      res.json({
        testId: testCase.id,
        prompt: testCase.prompt,
        success: false,
        error: error.message,
        latency: Date.now() - startedAt,
        apiCalls: 0
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/run-all', async (req, res) => {
  try {
    const maxCases = Number.parseInt(process.env.EVAL_MAX_CASES || '0', 10);
    const fastMode = resolveFastMode(req);
    const baseCases = maxCases > 0 ? EVAL_CASES.slice(0, maxCases) : EVAL_CASES;
    const testCases = fastMode && EVAL_MAX_CASES_FAST > 0
      ? baseCases.slice(0, EVAL_MAX_CASES_FAST)
      : baseCases;
    const results = [];
    const delayMs = fastMode ? EVAL_DELAY_FAST_MS : EVAL_DELAY_MS;
    const caseTimeoutMs = fastMode ? EVAL_CASE_TIMEOUT_FAST_MS : EVAL_CASE_TIMEOUT_MS;
    for (const testCase of testCases) {
      const startedAt = Date.now();
      let result = null;
      try {
        result = await withTimeout(
          runEvalCase(testCase, fastMode),
          caseTimeoutMs,
          `Eval ${testCase.id}`
        );
      } catch (error) {
        result = {
          testId: testCase.id,
          prompt: testCase.prompt,
          success: false,
          error: error.message,
          latency: Date.now() - startedAt,
          apiCalls: 0
        };
      }
      results.push(result);
      // Add small delay between requests
      if (!result?.success && typeof result?.error === 'string') {
        if (result.error.toLowerCase().includes('rate limit') || result.error.includes('429')) {
          await delay(Math.max(delayMs, 5000));
          continue;
        }
      }
      await delay(delayMs);
    }

    const stats = {
      totalTests: results.length,
      successCount: results.filter(r => r.success).length,
      avgLatency: Math.round(results.reduce((sum, r) => sum + r.latency, 0) / results.length),
      avgApiCalls: (results.reduce((sum, r) => sum + r.apiCalls, 0) / results.length).toFixed(2),
      errorCount: results.filter(r => !r.success).length
    };

    res.json({
      results: results,
      stats: stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const results = await getEvalResults();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
