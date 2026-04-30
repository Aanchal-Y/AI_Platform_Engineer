const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

function isGroqKey(value) {
  return typeof value === 'string' && value.startsWith('gsk_');
}

function resolveGroqApiKey() {
  const directKey = process.env.GROQ_API_KEY;
  if (directKey) {
    return directKey;
  }

  const fallbackKey = isGroqKey(process.env.ANTHROPIC_API_KEY) ? process.env.ANTHROPIC_API_KEY : '';
  if (fallbackKey) {
    return fallbackKey;
  }

  throw new Error('Missing GROQ_API_KEY environment variable');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }

    if (typeof req.body === 'string') {
      try {
        resolve(JSON.parse(req.body));
      } catch (error) {
        reject(error);
      }
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function slugify(value, separator = '_') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`${separator}+`, 'g'), separator)
    .replace(new RegExp(`^${separator}|${separator}$`, 'g'), '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferPromptShape(prompt) {
  const text = String(prompt || '').toLowerCase();
  const featureMap = [
    ['login', 'login'],
    ['sign in', 'login'],
    ['auth', 'login'],
    ['dashboard', 'dashboard'],
    ['analytics', 'analytics'],
    ['payment', 'payments'],
    ['billing', 'payments'],
    ['subscription', 'subscriptions'],
    ['contact', 'contacts'],
    ['project', 'projects'],
    ['task', 'tasks'],
    ['comment', 'comments'],
    ['notification', 'notifications'],
    ['post', 'posts'],
    ['recipe', 'recipes'],
    ['workout', 'workouts'],
    ['exercise', 'exercises'],
    ['product', 'products'],
    ['order', 'orders'],
    ['cart', 'cart'],
    ['ticket', 'tickets'],
    ['employee', 'employees'],
    ['leave', 'leave_requests'],
    ['invoice', 'invoices'],
    ['property', 'properties'],
    ['review', 'reviews'],
    ['rating', 'ratings'],
    ['message', 'messages']
  ];

  const entityMap = [
    ['user', 'users'],
    ['team', 'teams'],
    ['project', 'projects'],
    ['task', 'tasks'],
    ['comment', 'comments'],
    ['notification', 'notifications'],
    ['post', 'posts'],
    ['recipe', 'recipes'],
    ['workout', 'workouts'],
    ['exercise', 'exercises'],
    ['product', 'products'],
    ['order', 'orders'],
    ['cart', 'carts'],
    ['contact', 'contacts'],
    ['company', 'companies'],
    ['ticket', 'tickets'],
    ['invoice', 'invoices'],
    ['subscription', 'subscriptions'],
    ['property', 'properties'],
    ['employee', 'employees'],
    ['leave', 'leave_requests'],
    ['payroll', 'payroll_records']
  ];

  const features = unique(featureMap.filter(([needle]) => text.includes(needle)).map(([, feature]) => feature));
  const entities = unique(entityMap.filter(([needle]) => text.includes(needle)).map(([, entity]) => entity));
  const roles = /admin|manager|moderator|seller|analytics|dashboard/i.test(prompt) ? ['user', 'admin'] : ['user'];
  const assumptions = [];

  if (features.length === 0) {
    features.push('dashboard', 'management');
    assumptions.push('No clear feature list was provided, so a basic dashboard and management flow was assumed.');
  }

  if (entities.length === 0) {
    entities.push('items');
    assumptions.push('No explicit entities were provided, so a generic item collection was assumed.');
  }

  if (!text.includes('login')) {
    assumptions.push('Authentication was assumed because most applications need at least a basic user role.');
  }

  return { features, entities, roles, assumptions };
}

function buildTables(entities) {
  return unique(entities).map((entity) => {
    const tableName = slugify(entity, '_');
    const fields = [
      { name: 'id', type: 'uuid', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'text', required: false },
      { name: 'created_at', type: 'datetime', required: true },
      { name: 'updated_at', type: 'datetime', required: true }
    ];

    if (!['user', 'admin'].includes(tableName)) {
      fields.splice(3, 0, { name: 'user_id', type: 'uuid', required: false });
    }

    return {
      name: tableName,
      fields,
      relations: tableName === 'user' ? [] : [{ to: 'user', type: 'many-to-one' }]
    };
  });
}

function buildEndpoints(tables, roles) {
  const endpoints = [];

  for (const table of tables) {
    const path = `/${table.name.replace(/_/g, '-')}`;
    endpoints.push(
      { path, method: 'GET', description: `List all ${table.name}`, request: {}, response: {}, auth_required: true, roles_allowed: roles },
      { path: `${path}/:id`, method: 'GET', description: `Get ${table.name} by ID`, request: {}, response: {}, auth_required: true, roles_allowed: roles },
      { path, method: 'POST', description: `Create new ${table.name}`, request: {}, response: {}, auth_required: true, roles_allowed: roles },
      { path: `${path}/:id`, method: 'PUT', description: `Update ${table.name}`, request: {}, response: {}, auth_required: true, roles_allowed: roles },
      { path: `${path}/:id`, method: 'DELETE', description: `Delete ${table.name}`, request: {}, response: {}, auth_required: true, roles_allowed: roles }
    );
  }

  endpoints.push(
    { path: '/auth/login', method: 'POST', description: 'User login', request: {}, response: {}, auth_required: false, roles_allowed: roles },
    { path: '/auth/logout', method: 'POST', description: 'User logout', request: {}, response: {}, auth_required: true, roles_allowed: roles },
    { path: '/auth/profile', method: 'GET', description: 'Get current user profile', request: {}, response: {}, auth_required: true, roles_allowed: roles }
  );

  return endpoints;
}

function buildPages(tables) {
  const primaryTable = tables[0]?.name || 'items';
  const pages = [
    {
      name: 'Landing',
      route: '/',
      auth_required: false,
      components: [{ type: 'card', data_source: `/${primaryTable.replace(/_/g, '-')}`, fields: ['name', 'description'] }]
    },
    {
      name: 'Dashboard',
      route: '/dashboard',
      auth_required: true,
      components: [
        { type: 'chart', data_source: `/${primaryTable.replace(/_/g, '-')}`, fields: ['created_at'] },
        { type: 'table', data_source: `/${primaryTable.replace(/_/g, '-')}`, fields: ['id', 'name', 'description'] }
      ]
    }
  ];

  for (const table of tables) {
    pages.push({
      name: `${titleCase(table.name)} Management`,
      route: `/${table.name.replace(/_/g, '-')}`,
      auth_required: true,
      components: [{ type: 'table', data_source: `/${table.name.replace(/_/g, '-')}`, fields: ['id', 'name', 'description', 'created_at'] }]
    });
  }

  return pages;
}

function buildValidation(config) {
  const issues = [];
  const warnings = [];

  const requiredSections = ['app', 'database', 'api', 'ui', 'auth', 'business_logic'];
  for (const section of requiredSections) {
    if (!config[section]) {
      issues.push({ code: 'MISSING_SECTION', severity: 'error', message: `Missing required section: ${section}`, path: section });
    }
  }

  if (!config.database?.tables?.length) {
    issues.push({ code: 'MISSING_TABLES', severity: 'error', message: 'Database tables were not generated', path: 'database.tables' });
  }

  if (!config.api?.endpoints?.length) {
    issues.push({ code: 'MISSING_ENDPOINTS', severity: 'error', message: 'API endpoints were not generated', path: 'api.endpoints' });
  }

  if (!config.ui?.pages?.length) {
    warnings.push({ code: 'MISSING_PAGES', severity: 'warning', message: 'UI pages are sparse', path: 'ui.pages' });
  }

  return {
    status: issues.length > 0 ? 'warning' : 'passed',
    total_issues: issues.length + warnings.length,
    errors: issues,
    warnings,
    fixes_applied: 0,
    issues_found: [...issues, ...warnings]
  };
}

function normalizeCompilerResult(raw, prompt, metadata = {}) {
  const shape = inferPromptShape(prompt);
  const appName = raw?.app?.name || titleCase(prompt).slice(0, 60) || 'Generated App';
  const tables = Array.isArray(raw?.database?.tables) && raw.database.tables.length > 0
    ? raw.database.tables
    : buildTables(shape.entities, shape.roles);

  const config = {
    app: {
      name: appName,
      description: raw?.app?.description || `Generated application for ${titleCase(prompt).slice(0, 120) || 'general use'}.`
    },
    database: { tables },
    api: { endpoints: Array.isArray(raw?.api?.endpoints) && raw.api.endpoints.length > 0 ? raw.api.endpoints : buildEndpoints(tables, shape.roles) },
    ui: { pages: Array.isArray(raw?.ui?.pages) && raw.ui.pages.length > 0 ? raw.ui.pages : buildPages(tables) },
    auth: {
      roles: Array.isArray(raw?.auth?.roles) && raw.auth.roles.length > 0 ? raw.auth.roles : shape.roles,
      permissions: Array.isArray(raw?.auth?.permissions) && raw.auth.permissions.length > 0
        ? raw.auth.permissions
        : shape.roles.map((role) => ({ role, actions: role === 'admin' ? ['manage_all', 'read_analytics', 'manage_users'] : ['view_own', 'create', 'edit_own'] }))
    },
    business_logic: {
      role_restrictions: Array.isArray(raw?.business_logic?.role_restrictions) && raw.business_logic.role_restrictions.length > 0
        ? raw.business_logic.role_restrictions
        : shape.roles.map((role) => ({ role, allowed_features: role === 'admin' ? shape.features : shape.features.filter((feature) => !['analytics', 'admin'].includes(feature)) })),
      workflows: Array.isArray(raw?.business_logic?.workflows) && raw.business_logic.workflows.length > 0
        ? raw.business_logic.workflows
        : shape.features.map((feature) => ({ feature, description: `${feature} workflow: complete end-to-end process for managing ${feature}` })),
      premium_features: Array.isArray(raw?.business_logic?.premium_features) ? raw.business_logic.premium_features : shape.features.filter((feature) => ['payments', 'analytics', 'reporting'].includes(feature)),
      rules: Array.isArray(raw?.business_logic?.rules) && raw.business_logic.rules.length > 0
        ? raw.business_logic.rules
        : [
            { rule: 'Only admins can access analytics', applies_to: 'analytics', enforcement: 'API-level role check' },
            { rule: 'Users can only view own data by default', applies_to: 'all_tables', enforcement: 'Row-level security via user_id filter' }
          ]
    },
    validation: buildValidation(raw || {}),
    assumptions: Array.isArray(raw?.assumptions) && raw.assumptions.length > 0 ? raw.assumptions : shape.assumptions,
    metrics: {
      stages_completed: 6,
      latency_ms: metadata.latencyMs || 0,
      api_calls: metadata.apiCalls || 1
    },
    status: 'success'
  };

  if (config.validation.status !== 'passed') {
    config.status = 'warning';
  }

  return config;
}

async function callGroq(prompt, options = {}) {
  const apiKey = resolveGroqApiKey();
  const payload = {
    model: options.model || GROQ_MODEL,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens || 1200,
    messages: [
      { role: 'system', content: options.system || 'Return valid JSON only.' },
      { role: 'user', content: prompt }
    ]
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Groq API error (${response.status}): ${text}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error('Groq API returned invalid JSON');
  }

  return {
    content: json?.choices?.[0]?.message?.content || '',
    usage: json?.usage || {}
  };
}

function extractJson(content) {
  if (!content) {
    return null;
  }

  const trimmed = String(content).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (innerError) {
        return null;
      }
    }
    return null;
  }
}

async function generateCompilerResult(prompt, options = {}) {
  const startedAt = Date.now();
  const systemPrompt = [
    'You are an application compiler.',
    'Return only valid JSON.',
    'The JSON must include app, database, api, ui, auth, business_logic, validation, assumptions, and metrics.',
    'Use concise but complete content.',
    'Include database.tables with fields and relations, api.endpoints, ui.pages, auth.roles, auth.permissions, and business_logic.role_restrictions/workflows.'
  ].join(' ');

  try {
    const groq = await callGroq(
      `Compile this app request into a JSON specification:\n\n${prompt}`,
      { system: systemPrompt, maxTokens: options.maxTokens || 1600, temperature: 0, model: options.model || GROQ_MODEL }
    );

    const parsed = extractJson(groq.content);
    if (parsed) {
      return normalizeCompilerResult(parsed, prompt, {
        latencyMs: Date.now() - startedAt,
        apiCalls: 1
      });
    }
  } catch (error) {
    // Fall through to the local generator so deployment still works if the API is unavailable.
  }

  return normalizeCompilerResult({}, prompt, {
    latencyMs: Date.now() - startedAt,
    apiCalls: 0
  });
}

module.exports = {
  callGroq,
  extractJson,
  generateCompilerResult,
  normalizeCompilerResult,
  readBody,
  resolveGroqApiKey,
  titleCase
};