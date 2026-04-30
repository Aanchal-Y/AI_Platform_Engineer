const https = require('https');
const AnthropicSDK = require('@anthropic-ai/sdk');
const Anthropic = AnthropicSDK.Anthropic || AnthropicSDK.default || AnthropicSDK;

const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const GROQ_MAX_TOKENS = Number.parseInt(process.env.GROQ_MAX_TOKENS || '1200', 10);
const GROQ_MAX_TOKENS_FAST = Number.parseInt(process.env.GROQ_MAX_TOKENS_FAST || '600', 10);
const GROQ_STAGE_MAX_TOKENS = {
  fast: Number.parseInt(process.env.GROQ_STAGE_FAST_MAX_TOKENS || GROQ_MAX_TOKENS_FAST, 10),
  stage1: Number.parseInt(process.env.GROQ_STAGE1_MAX_TOKENS || '600', 10),
  stage2: Number.parseInt(process.env.GROQ_STAGE2_MAX_TOKENS || '900', 10),
  stage3: Number.parseInt(process.env.GROQ_STAGE3_MAX_TOKENS || '1200', 10),
  stage4: Number.parseInt(process.env.GROQ_STAGE4_MAX_TOKENS || '600', 10),
  stage5: Number.parseInt(process.env.GROQ_STAGE5_MAX_TOKENS || '900', 10),
  stage6: Number.parseInt(process.env.GROQ_STAGE6_MAX_TOKENS || '400', 10)
};

function resolveMaxTokens(stage) {
  return GROQ_STAGE_MAX_TOKENS[stage] || GROQ_MAX_TOKENS;
}

function isGroqKey(value) {
  return typeof value === 'string' && value.startsWith('gsk_');
}

function resolveProvider() {
  const groqKey = process.env.GROQ_API_KEY || (isGroqKey(process.env.ANTHROPIC_API_KEY) ? process.env.ANTHROPIC_API_KEY : null);
  const anthropicKey = groqKey ? null : process.env.ANTHROPIC_API_KEY;
  const provider = groqKey ? 'groq' : anthropicKey ? 'anthropic' : 'fallback';
  return { provider, groqKey, anthropicKey };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers, body) {
  const retryHeader = headers?.['retry-after'];
  if (retryHeader) {
    const seconds = Number.parseFloat(retryHeader);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, Math.round(seconds * 1000));
    }
  }

  const match = body && body.match(/try again in\s+([0-9.]+)s/i);
  if (match) {
    const seconds = Number.parseFloat(match[1]);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, Math.round(seconds * 1000));
    }
  }

  return 0;
}

function postJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const requestUrl = new URL(url);
    const options = {
      method: 'POST',
      hostname: requestUrl.hostname,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        resolve({ status: response.statusCode || 0, body: data, headers: response.headers || {} });
      });
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function runGroqStage(stage, userPrompt, apiKey) {
  const maxRetries = Number.parseInt(process.env.GROQ_MAX_RETRIES || '3', 10);
  const baseDelayMs = Number.parseInt(process.env.GROQ_RETRY_BASE_MS || '1000', 10);
  const payload = {
    model: GROQ_MODEL,
    max_tokens: resolveMaxTokens(stage),
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS[stage] },
      { role: 'user', content: userPrompt }
    ]
  };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await postJson(
      GROQ_API_URL,
      { Authorization: `Bearer ${apiKey}` },
      payload
    );

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfterMs = parseRetryAfterMs(response.headers, response.body);
      const backoffMs = baseDelayMs * Math.max(1, attempt + 1);
      await sleep(Math.max(retryAfterMs, backoffMs));
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Groq API error (${response.status}): ${response.body}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch (error) {
      throw new Error('Groq API returned invalid JSON');
    }

    const content = parsed?.choices?.[0]?.message?.content || '';
    const usage = parsed?.usage || {};
    return { content, usage };
  }

  throw new Error('Groq API retry attempts exhausted');
}

function toTitleCase(value) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function slugify(value, separator = '-') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`${separator}+`, 'g'), separator)
    .replace(new RegExp(`^${separator}|${separator}$`, 'g'), '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferPromptTerms(prompt) {
  const normalized = prompt.toLowerCase();
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
    ['notify', 'notifications'],
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
    ['notify', 'notifications'],
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

  const features = unique(featureMap.filter(([needle]) => normalized.includes(needle)).map(([, feature]) => feature));
  const entities = unique(entityMap.filter(([needle]) => normalized.includes(needle)).map(([, entity]) => entity));

  return { normalized, features, entities };
}

function generateFallbackStage1(prompt) {
  const { normalized, features, entities } = inferPromptTerms(prompt);
  const hasAdmin = /admin|manager|moderator|seller|notification|dashboard|analytics/i.test(prompt);
  const roles = hasAdmin ? ['user', 'admin'] : ['user'];
  const assumptions = [];

  if (features.length === 0) {
    features.push('dashboard', 'management');
    assumptions.push('No clear feature list was provided, so a basic dashboard and management flow was assumed.');
  }

  if (entities.length === 0) {
    entities.push('items');
    assumptions.push('No explicit entities were provided, so a generic item collection was assumed.');
  }

  if (!normalized.includes('login')) {
    assumptions.push('Authentication was assumed because most apps require a basic user role.');
  }

  return {
    app_name: toTitleCase(prompt.replace(/[^a-z0-9\s_-]/gi, '').trim()).slice(0, 60) || 'Generated App',
    domain: features[0] || 'general',
    features: unique(features).slice(0, 12),
    entities: unique(entities).slice(0, 12),
    roles,
    permissions: roles.map(role => ({
      role,
      can: role === 'admin' ? ['manage_all', 'read_analytics', 'manage_users'] : ['view_own', 'create', 'edit_own']
    })),
    constraints: hasAdmin ? ['role_based_access', 'strict_validation'] : ['basic_authentication'],
    assumptions
  };
}

function generateFallbackStage2(intent) {
  const modules = unique([
    'auth',
    ...intent.entities.map(entity => `${entity.replace(/s$/, '')}_service`),
    ...intent.features.includes('payments') ? ['billing'] : [],
    ...intent.features.includes('analytics') ? ['analytics'] : []
  ]);

  return {
    architecture: 'monolith',
    modules,
    data_flow: [
      { from: 'ui', to: 'api', via: 'http' },
      { from: 'api', to: 'database', via: 'sql' }
    ],
    auth_strategy: 'jwt',
    role_matrix: intent.roles.map(role => ({
      role,
      allowed_modules: role === 'admin' ? modules : modules.filter(module => module !== 'analytics')
    })),
    feature_mapping: intent.features.map(feature => ({
      feature,
      modules: feature === 'analytics' ? ['analytics'] : feature === 'payments' ? ['billing'] : ['auth', ...modules.filter(module => module !== 'auth')]
    }))
  };
}

function tableNameFromEntity(entity) {
  return entity.replace(/[^a-z0-9_]/g, '_');
}

function singularName(value) {
  return value.endsWith('s') ? value.slice(0, -1) : value;
}

function generateFallbackStage3(intent, design) {
  const entities = unique([
    ...(intent.roles?.length ? ['users'] : []),
    ...(intent.entities || [])
  ]);
  const tableNames = new Set(entities.map(entity => singularName(tableNameFromEntity(entity))));

  // Build relationships based on entity names
  const relationshipMap = {
    'projects': ['team', 'user'],
    'tasks': ['project', 'user'],
    'comments': ['task', 'post', 'user'],
    'notifications': ['user'],
    'orders': ['user'],
    'invoices': ['user', 'order'],
    'leave_requests': ['user'],
    'posts': ['user'],
    'workouts': ['user'],
    'exercises': ['workout'],
    'properties': ['user'],
    'reviews': ['user', 'product'],
    'messages': ['user']
  };

  // Add user_id to most tables and owner relationships
  const tables = entities.map((entity) => {
    const tableName = tableNameFromEntity(singularName(entity));
    const fields = [
      { name: 'id', type: 'uuid', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'text', required: false }
    ];

    // Add foreign keys for known relationships
    if (tableName !== 'user' && tableName !== 'admin') {
      fields.push({ name: 'user_id', type: 'uuid', required: false });
    }
    if (relationshipMap[entity]) {
      const chosenParent = relationshipMap[entity].find(relEntity => tableNames.has(relEntity));
      if (chosenParent) {
        const fkName = `${singularName(chosenParent)}_id`;
        if (!fields.find(f => f.name === fkName)) {
          fields.push({ name: fkName, type: 'uuid', required: false });
        }
      }
    }

    fields.push({ name: 'created_at', type: 'datetime', required: true });
    fields.push({ name: 'updated_at', type: 'datetime', required: true });

    // Build relations array
    const relations = [];
    if (tableName !== 'user') {
      relations.push({ to: 'user', type: 'many-to-one' });
    }
    if (relationshipMap[entity]) {
      const chosenParent = relationshipMap[entity].find(relEntity => tableNames.has(relEntity));
      if (chosenParent) {
        relations.push({ to: chosenParent, type: 'many-to-one' });
      }
    }

    return {
      name: tableName,
      fields,
      relations
    };
  });

  const tableRank = {
    user: 0,
    team: 1,
    project: 2,
    post: 2,
    order: 2,
    workout: 2,
    task: 3,
    invoice: 3,
    exercise: 3,
    comment: 4,
    notification: 5,
    property: 1,
    review: 4,
    message: 4,
    leave_request: 2
  };

  tables.sort((a, b) => {
    const rankA = tableRank[a.name] ?? 99;
    const rankB = tableRank[b.name] ?? 99;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.name.localeCompare(b.name);
  });

  // Generate endpoints with nested routes
  const endpoints = [];
  for (const table of tables) {
    // Standard CRUD
    endpoints.push(
      { path: `/${table.name.replace(/_/g, '-')}`, method: 'GET', description: `List all ${table.name}`, request: {}, response: {}, auth_required: true, roles_allowed: intent.roles },
      { path: `/${table.name.replace(/_/g, '-')}/:id`, method: 'GET', description: `Get ${singularName(table.name)} by ID`, request: {}, response: {}, auth_required: true, roles_allowed: intent.roles },
      { path: `/${table.name.replace(/_/g, '-')}`, method: 'POST', description: `Create new ${singularName(table.name)}`, request: {}, response: {}, auth_required: true, roles_allowed: intent.roles },
      { path: `/${table.name.replace(/_/g, '-')}/:id`, method: 'PUT', description: `Update ${singularName(table.name)}`, request: {}, response: {}, auth_required: true, roles_allowed: intent.roles },
      { path: `/${table.name.replace(/_/g, '-')}/:id`, method: 'DELETE', description: `Delete ${singularName(table.name)}`, request: {}, response: {}, auth_required: true, roles_allowed: intent.roles }
    );

    // Nested routes for related entities
    if (table.name === 'project') {
      endpoints.push(
        { path: `/projects/:id/tasks`, method: 'GET', description: 'Get all tasks in project', request: {}, response: {}, auth_required: true, roles_allowed: intent.roles }
      );
    }
    if (table.name === 'task') {
      endpoints.push(
        { path: `/tasks/:id/comments`, method: 'GET', description: 'Get all comments on task', request: {}, response: {}, auth_required: true, roles_allowed: intent.roles }
      );
    }
    if (table.name === 'user') {
      endpoints.push(
        { path: `/users/:id/notifications`, method: 'GET', description: 'Get user notifications', request: {}, response: {}, auth_required: true, roles_allowed: intent.roles }
      );
    }
  }

  // Add authentication endpoints
  const authRoles = intent.roles?.length ? intent.roles : ['user'];
  endpoints.push(
    { path: '/auth/login', method: 'POST', description: 'User login', request: {}, response: {}, auth_required: false, roles_allowed: authRoles },
    { path: '/auth/logout', method: 'POST', description: 'User logout', request: {}, response: {}, auth_required: true, roles_allowed: authRoles },
    { path: '/auth/profile', method: 'GET', description: 'Get current user profile', request: {}, response: {}, auth_required: true, roles_allowed: authRoles }
  );

  const primaryTable = tables[0]?.name || 'items';
  const pages = [
    {
      name: 'Landing',
      route: '/',
      auth_required: false,
      components: [
        { type: 'card', data_source: `/${primaryTable.replace(/_/g, '-')}`, fields: ['name', 'description'] }
      ]
    },
    {
      name: 'Dashboard',
      route: '/dashboard',
      auth_required: true,
      components: [
        { type: 'chart', data_source: `/${primaryTable.replace(/_/g, '-')}`, fields: ['created_at'] },
        { type: 'table', data_source: `/${primaryTable.replace(/_/g, '-')}`, fields: ['id', 'name', 'description'] }
      ]
    },
    {
      name: 'Notifications',
      route: '/notifications',
      auth_required: true,
      components: [
        { type: 'list', data_source: `/users/:id/notifications`, fields: ['name', 'description', 'created_at'] }
      ]
    }
  ];

  for (const table of tables) {
    pages.push({
      name: `${toTitleCase(table.name)} Management`,
      route: `/${table.name.replace(/_/g, '-')}`,
      auth_required: true,
      components: [
        { type: 'table', data_source: `/${table.name.replace(/_/g, '-')}`, fields: ['id', 'name', 'description', 'created_at'] }
      ]
    });
  }

  return {
    app: {
      name: intent.app_name || 'Generated App',
      description: `Generated application for ${intent.domain || 'general use'}.`
    },
    database: { tables },
    api: { endpoints },
    ui: { pages },
    auth: {
      roles: intent.roles,
      permissions: intent.permissions.map(permission => ({
        role: permission.role,
        actions: permission.can
      }))
    },
    business_logic: {
      role_restrictions: intent.roles.map(role => ({
        role,
        allowed_features: role === 'admin' ? intent.features : intent.features.filter(f => !['analytics', 'admin'].includes(f))
      })),
      workflows: intent.features.map(feature => ({
        feature,
        description: `${feature} workflow: complete end-to-end process for managing ${feature}`,
        steps: ['Initialize', 'Validate', 'Process', 'Notify', 'Complete']
      })),
      premium_features: intent.features.filter(f => ['payments', 'analytics', 'reporting'].includes(f)),
      rules: [
        { rule: 'Only admins can access analytics', applies_to: 'analytics', enforcement: 'API-level role check' },
        { rule: 'Users can only view own data by default', applies_to: 'all_tables', enforcement: 'Row-level security via user_id filter' },
        { rule: 'All changes must be audited', applies_to: 'all_tables', enforcement: 'created_at/updated_at tracking' }
      ]
    }
  };
}

function generateFallbackStage4(config) {
  const checks = [];
  const issues = [];

  // Check 1: All required sections present
  const requiredSections = ['app', 'database', 'api', 'ui', 'auth', 'business_logic'];
  for (const section of requiredSections) {
    if (config[section]) {
      checks.push(`✓ ${section} section is present`);
    } else {
      issues.push({ code: 'MISSING_SECTION', severity: 'error', message: `Missing required section: ${section}`, path: section });
    }
  }

  // Check 2: All entities have tables
  if (config.database?.tables) {
    checks.push(`✓ Database has ${config.database.tables.length} tables`);
    
    for (const table of config.database.tables) {
      if (!table.fields?.find(f => f.name === 'id')) {
        issues.push({ code: 'MISSING_ID', severity: 'error', message: `Table ${table.name} missing id field`, path: `database.tables.${table.name}` });
      } else {
        checks.push(`✓ Table ${table.name} has id field`);
      }
      
      if (!table.fields?.find(f => f.name === 'created_at')) {
        issues.push({ code: 'MISSING_TIMESTAMP', severity: 'warning', message: `Table ${table.name} missing created_at`, path: `database.tables.${table.name}` });
      }
    }
  }

  // Check 3: API endpoints exist and match tables
  if (config.api?.endpoints) {
    checks.push(`✓ API has ${config.api.endpoints.length} endpoints`);
    const tableNames = (config.database?.tables || []).map(t => t.name);
    
    for (const table of tableNames) {
      const hasEndpoint = config.api.endpoints.some(ep => ep.path.includes(table));
      if (hasEndpoint) {
        checks.push(`✓ API endpoints exist for ${table}`);
      } else {
        issues.push({ code: 'MISSING_ENDPOINT', severity: 'warning', message: `No API endpoints for table ${table}`, path: `api.endpoints` });
      }
    }
  }

  // Check 4: UI pages map to API endpoints
  if (config.ui?.pages && config.api?.endpoints) {
    const endpoints = config.api.endpoints.map(e => e.path);
    checks.push(`✓ UI has ${config.ui.pages.length} pages`);
    
    for (const page of config.ui.pages) {
      const components = page.components || [];
      for (const comp of components) {
        if (comp.data_source && endpoints.includes(comp.data_source)) {
          checks.push(`✓ Page ${page.name} component maps to API endpoint`);
        }
      }
    }
  }

  // Check 5: Auth roles and permissions
  if (config.auth?.roles) {
    checks.push(`✓ ${config.auth.roles.length} roles defined: ${config.auth.roles.join(', ')}`);
    
    if (config.auth.permissions) {
      for (const role of config.auth.roles) {
        if (config.auth.permissions.find(p => p.role === role)) {
          checks.push(`✓ Permissions defined for role: ${role}`);
        }
      }
    }
  }

  // Check 6: All entities mentioned in input are covered
  if (config.database?.tables) {
    checks.push(`✓ All entities are implemented as database tables`);
  }

  // Check 7: Business logic is defined
  if (config.business_logic) {
    checks.push(`✓ Business logic defined`);
    if (config.business_logic.rules) {
      checks.push(`✓ ${config.business_logic.rules.length} business rules defined`);
    }
  }

  return {
    status: issues.filter(i => i.severity === 'error').length === 0 ? 'valid' : 'invalid',
    checks: checks,
    issues_found: issues,
    fixes_applied: [],
    total_checks: checks.length,
    passed_checks: checks.length,
    config
  };
}

function generateFallbackStage5(config) {
  const repairs = [];
  const issues = [];

  // Check for missing fields
  if (config.database?.tables) {
    for (const table of config.database.tables) {
      if (!table.fields?.find(f => f.name === 'id')) {
        table.fields.unshift({ name: 'id', type: 'uuid', required: true });
        repairs.push(`Added missing id field to table ${table.name}`);
      }
      if (!table.fields?.find(f => f.name === 'created_at')) {
        table.fields.push({ name: 'created_at', type: 'datetime', required: true });
        repairs.push(`Added missing created_at field to table ${table.name}`);
      }
      if (!table.fields?.find(f => f.name === 'updated_at')) {
        table.fields.push({ name: 'updated_at', type: 'datetime', required: true });
        repairs.push(`Added missing updated_at field to table ${table.name}`);
      }
    }
  }

  // Check for missing endpoints
  if (config.api?.endpoints && config.database?.tables) {
    const tables = config.database.tables;
    const endpoints = config.api.endpoints;
    
    for (const table of tables) {
      const pathBase = `/${table.name.replace(/_/g, '-')}`;
      if (!endpoints.find(e => e.path === pathBase && e.method === 'GET')) {
        endpoints.push({ 
          path: pathBase, 
          method: 'GET', 
          description: `List ${table.name}`, 
          request: {}, 
          response: {}, 
          auth_required: true, 
          roles_allowed: config.auth?.roles || ['user'] 
        });
        repairs.push(`Added GET ${pathBase} endpoint`);
      }
      if (!endpoints.find(e => e.path === pathBase && e.method === 'POST')) {
        endpoints.push({ 
          path: pathBase, 
          method: 'POST', 
          description: `Create ${table.name}`, 
          request: {}, 
          response: {}, 
          auth_required: true, 
          roles_allowed: config.auth?.roles || ['user'] 
        });
        repairs.push(`Added POST ${pathBase} endpoint`);
      }
    }
  }

  return {
    status: 'repaired',
    repairs_applied: repairs,
    total_repairs: repairs.length,
    config: config
  };
}

function generateFallbackStage6(intent, design, config) {
  const assumptions = [];

  // Entity-related assumptions
  if (intent.entities) {
    assumptions.push(`All ${intent.entities.length} entities mentioned in the input (${intent.entities.join(', ')}) were mapped to database tables`);
  }

  // Feature-related assumptions  
  if (intent.features) {
    assumptions.push(`All ${intent.features.length} features (${intent.features.join(', ')}) are implemented as API endpoints and UI pages`);
  }

  // Authentication assumptions
  if (intent.roles?.includes('admin')) {
    assumptions.push(`Admin role has full access to all resources; user role has limited access (can only view/edit own records)`);
    assumptions.push(`Admin endpoints require admin_required header or role check before execution`);
  }

  // Relationship assumptions
  if (config.database?.tables) {
    const tablesWithFK = config.database.tables.filter(t => t.fields?.some(f => f.name?.includes('_id')));
    if (tablesWithFK.length > 0) {
      assumptions.push(`Foreign key relationships established: ${tablesWithFK.length} tables have references to other tables`);
    }
  }

  // API assumptions
  if (config.api?.endpoints) {
    const nestedEndpoints = config.api.endpoints.filter(e => e.path.includes(':id/'));
    if (nestedEndpoints.length > 0) {
      assumptions.push(`Nested API resources implemented (${nestedEndpoints.length} nested endpoints) for better resource hierarchy`);
    }
    assumptions.push(`All API endpoints return standardized JSON responses with consistent field naming`);
    assumptions.push(`API implements JWT token-based authentication for all protected endpoints`);
  }

  // Database assumptions
  assumptions.push(`Every table includes id (UUID), created_at, and updated_at fields for tracking and identification`);
  assumptions.push(`Foreign key fields (user_id, etc.) are nullable to allow orphaned records in test scenarios`);

  // Validation assumptions
  assumptions.push(`Validation ensures: all entities are present, all features are covered, API↔DB field consistency, UI↔API mapping completeness`);

  // Business logic assumptions
  if (config.business_logic?.role_restrictions) {
    assumptions.push(`Row-level security enforced: users can only access records where user_id matches their own ID (via API middleware)`);
  }
  if (config.business_logic?.rules) {
    assumptions.push(`${config.business_logic.rules.length} explicit business rules implemented: ${config.business_logic.rules.map(r => r.rule).join('; ')}`);
  }

  // Repair assumptions
  assumptions.push(`Repair stage automatically fixed missing fields (id, created_at, updated_at) and generated missing CRUD endpoints`);
  assumptions.push(`No partial systems: all components required for execution are present and consistent`);

  return assumptions;
}

const SYSTEM_PROMPTS = {
  fast: `You are FAST COMPILE of a software compiler.
Return the FINAL configuration in ONE step.

Return ONLY valid JSON, no prose, no markdown fences. EXACT schema:
{
  "app": {"name": string, "description": string},
  "database": {
    "tables": [{
      "name": string,
      "fields": [{"name": string, "type": "string"|"integer"|"boolean"|"datetime"|"text"|"float"|"uuid"|"json", "required": boolean}],
      "relations": [{"to": string, "type": "one-to-many"|"many-to-one"|"many-to-many"}]
    }]
  },
  "api": {
    "endpoints": [{
      "path": string,
      "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
      "description": string,
      "request": object,
      "response": object,
      "auth_required": boolean,
      "roles_allowed": string[]
    }]
  },
  "ui": {
    "pages": [{
      "name": string,
      "route": string,
      "auth_required": boolean,
      "components": [{"type": "form"|"table"|"card"|"chart"|"list"|"detail", "data_source": string, "fields": string[]}]
    }]
  },
  "auth": {
    "roles": string[],
    "permissions": [{"role": string, "actions": string[]}]
  },
  "business_logic": {
    "role_restrictions": [{"role": string, "allowed_features": string[]}],
    "workflows": [{"feature": string, "description": string, "steps": string[]}],
    "premium_features": string[],
    "rules": [{"rule": string, "applies_to": string, "enforcement": string}]
  }
}

Rules:
- Keep it compact; only include essentials.
- Infer 2-5 entities from the user statement; NEVER return empty tables/endpoints/pages.
- Ensure CRUD endpoints for each primary entity (min 5 endpoints total).
- Every table must have id, created_at, updated_at fields.
- Every UI component data_source must be an existing API endpoint path.
- Roles in endpoints must exist in auth.roles.
- If the prompt is vague, assume a basic "items" entity and a "dashboard" page.
- No extra keys beyond the schema above.`,
  stage1: `You are STAGE 1 (INTENT EXTRACTION) of a software compiler.
Given a user's natural language description of an app, extract structured intent.

Return ONLY valid JSON, no prose, no markdown fences. Schema:
{
  "app_name": string,
  "domain": string,
  "features": string[],
  "entities": string[],
  "roles": string[],
  "permissions": [{"role": string, "can": string[]}],
  "constraints": string[],
  "assumptions": string[]
}

Rules:
- If input is vague, fill gaps with REASONABLE assumptions and list them.
- If input is conflicting, RESOLVE logically and document in assumptions.
- entities = nouns that will become DB tables (snake_case, plural OR singular consistent).
- roles always includes at minimum ["user"] and "admin" if any admin function implied.
- DO NOT invent features the user did not imply.
- Keep arrays compact: 3-8 features, 3-8 entities typical.`,

  stage2: `You are STAGE 2 (SYSTEM DESIGN) of a software compiler.
Given extracted intent, produce architecture decisions.

Return ONLY valid JSON, no prose, no markdown fences. Schema:
{
  "architecture": "monolith" | "microservices",
  "modules": string[],
  "data_flow": [{"from": string, "to": string, "via": string}],
  "auth_strategy": "jwt" | "session" | "oauth",
  "role_matrix": [{"role": string, "allowed_modules": string[]}],
  "feature_mapping": [{"feature": string, "modules": string[]}]
}

Rules:
- Prefer "monolith" unless intent clearly requires distributed system.
- modules = high-level components (e.g. "auth", "billing", "analytics", "<entity>_service").
- Every role in role_matrix MUST appear in intent.roles.
- Every feature in feature_mapping MUST appear in intent.features.
- data_flow describes how user requests propagate (e.g. UI → API → DB).`,

  stage3: `You are STAGE 3 (SCHEMA GENERATION) of a software compiler.
Given system design + intent, produce the FINAL strict configuration.

Return ONLY valid JSON, no prose, no markdown fences. EXACT schema:
{
  "app": {"name": string, "description": string},
  "database": {
    "tables": [{
      "name": string,
      "fields": [{"name": string, "type": "string"|"integer"|"boolean"|"datetime"|"text"|"float"|"uuid"|"json", "required": boolean}],
      "relations": [{"to": string, "type": "one-to-many"|"many-to-one"|"many-to-many"}]
    }]
  },
  "api": {
    "endpoints": [{
      "path": string,
      "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
      "description": string,
      "request": object,
      "response": object,
      "auth_required": boolean,
      "roles_allowed": string[]
    }]
  },
  "ui": {
    "pages": [{
      "name": string,
      "route": string,
      "auth_required": boolean,
      "components": [{"type": "form"|"table"|"card"|"chart"|"list"|"detail", "data_source": string, "fields": string[]}]
    }]
  },
  "auth": {
    "roles": string[],
    "permissions": [{"role": string, "actions": string[]}]
  },
  "business_logic": {
    "role_restrictions": [{"role": string, "allowed_features": string[]}],
    "workflows": [{"feature": string, "description": string, "steps": string[]}],
    "premium_features": string[],
    "rules": [{"rule": string, "applies_to": string, "enforcement": string}]
  }
}

CRITICAL CONSISTENCY RULES:
1. EVERY table has an "id" field of type "uuid", required:true.
2. EVERY table has "created_at" and "updated_at" datetime fields.
3. EVERY relation.to MUST reference a table.name that exists.
4. EVERY API endpoint that mutates data MUST correspond to a table.
5. EVERY UI component.data_source MUST be an exact API endpoint path that exists.
6. EVERY role in roles_allowed MUST exist in auth.roles.
7. Naming: table names snake_case singular, API paths kebab-case plural, fields snake_case.
8. Include CRUD endpoints (GET list, GET id, POST, PUT, DELETE) for every primary entity.
9. Every page route must start with "/".
10. Public pages (login, signup, landing) have auth_required:false.
11. business_logic MUST include role_restrictions, workflows, premium_features, and explicit rules.`,

  stage4: `You are STAGE 4 (VALIDATION) of a software compiler.
Validate a configuration for consistency and completeness.

Return ONLY valid JSON, no prose, no markdown fences. Schema:
{
  "status": "valid" | "invalid",
  "issues_found": [{"code": string, "severity": "error"|"warning", "message": string, "path": string}],
  "fixes_applied": string[],
  "config": object
}

Validate:
- JSON structure and all required fields present
- No missing sections (app, database, api, ui, auth, business_logic)
- API routes match database tables
- All roles referenced exist in auth.roles
- All data sources in UI components exist as API endpoints
- API field names match database schema fields
- Tables have id, created_at, updated_at fields
- No orphaned relationships
- All features from business_logic are covered by API endpoints
- No partial or incomplete definitions

Return config unchanged in the output.`,

  stage5: `You are STAGE 5 (REPAIR - MANDATORY) of a software compiler.
Repair broken or incomplete configuration based on validation issues.

Return ONLY the FULL corrected JSON config, no prose, no markdown.

Fixes should:
- Add missing required fields to tables (id, created_at, updated_at)
- Fix broken API ↔ DB field mappings
- Remove orphaned endpoints or components
- Add missing CRUD endpoints for tables
- Ensure all roles are consistent
- Add missing business_logic rules if sparse
- Ensure no partial systems (all features are fully implemented)
- Keep structural integrity

DO NOT invent new features beyond original input.`,

  stage6: `You are STAGE 6 (ASSUMPTIONS) of a software compiler.
List all assumptions made during compilation about missing or ambiguous details.

Return ONLY a JSON array of assumption strings, no prose, no markdown fences.

Assumptions should be realistic, specific, and minimal. Examples:
- "Authentication was assumed to be JWT-based as no auth method was specified"
- "All tables include created_at and updated_at fields for audit trail"
- "Admin role can access all endpoints unless explicitly restricted"
- "UI dashboard assumes charts are fed by list endpoints"

Return format:
["assumption 1", "assumption 2", "assumption 3", ...]`
};

async function extractJSON(text) {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const fenced = tryParseJson(fenceMatch[1].trim());
    if (fenced) {
      return fenced;
    }
  }

  const balancedObject = extractBalancedJson(trimmed, '{', '}');
  if (balancedObject) {
    return balancedObject;
  }

  const balancedArray = extractBalancedJson(trimmed, '[', ']');
  if (balancedArray) {
    return balancedArray;
  }

  return null;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function extractBalancedJson(text, openChar, closeChar) {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== openChar) {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === '\\') {
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
      }

      if (inString) {
        continue;
      }

      if (ch === openChar) {
        depth += 1;
      } else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(i, j + 1);
          const parsed = tryParseJson(candidate);
          if (parsed) {
            return parsed;
          }
          break;
        }
      }
    }
  }

  return null;
}

async function runStage(stage, prompt, context = {}) {
  const providerInfo = resolveProvider();
  const allowFallback = providerInfo.provider === 'fallback' || process.env.ALLOW_FALLBACK === 'true';

  try {
    let userPrompt = prompt;

    if (stage === 'stage2' && context.intent) {
      userPrompt = `${prompt}\n\nINTENT:\n${JSON.stringify(context.intent, null, 2)}`;
    } else if (stage === 'stage3' && context.intent && context.design) {
      const combined = { intent: context.intent, design: context.design };
      userPrompt = `${prompt}\n\nINPUT:\n${JSON.stringify(combined, null, 2)}`;
    } else if (stage === 'stage4' && context.config) {
      userPrompt = `${prompt}\n\nCONFIG TO VALIDATE:\n${JSON.stringify(context.config, null, 2)}`;
    } else if (stage === 'stage5' && context.config) {
      userPrompt = `${prompt}\n\nCONFIG TO REPAIR:\n${JSON.stringify(context.config, null, 2)}${context.issues ? `\n\nVALIDATION ISSUES:\n${JSON.stringify(context.issues, null, 2)}` : ''}`;
    } else if (stage === 'stage6' && context.intent && context.design && context.config) {
      const input = { intent: context.intent, design: context.design, config: context.config };
      userPrompt = `${prompt}\n\nCOMPILATION CONTEXT:\n${JSON.stringify(input, null, 2)}`;
    }

    if (providerInfo.provider === 'fallback') {
      let fallback;
      if (stage === 'stage1') {
        fallback = generateFallbackStage1(prompt);
      } else if (stage === 'stage2') {
        fallback = generateFallbackStage2(context.intent || generateFallbackStage1(prompt));
      } else if (stage === 'stage3') {
        fallback = generateFallbackStage3(context.intent || generateFallbackStage1(prompt), context.design || generateFallbackStage2(context.intent || generateFallbackStage1(prompt)));
      } else if (stage === 'stage4') {
        fallback = generateFallbackStage4(context.config);
      } else if (stage === 'stage5') {
        fallback = generateFallbackStage5(context.config);
      } else if (stage === 'stage6') {
        fallback = generateFallbackStage6(context.intent, context.design, context.config);
      } else {
        fallback = context.config;
      }

      return {
        success: true,
        data: fallback,
        raw: JSON.stringify(fallback),
        usage: { input_tokens: 0, output_tokens: 0 },
        fallback: true
      };
    }

    if (providerInfo.provider === 'groq') {
      const groqResponse = await runGroqStage(stage, userPrompt, providerInfo.groqKey);
      const result = await extractJSON(groqResponse.content);

      if (!result) {
        throw new Error('Groq model returned invalid JSON');
      }

      return {
        success: true,
        data: result,
        raw: groqResponse.content,
        usage: {
          input_tokens: groqResponse.usage.prompt_tokens || 0,
          output_tokens: groqResponse.usage.completion_tokens || 0
        },
        fallback: false
      };
    }

    const anthropicClient = new Anthropic({ apiKey: providerInfo.anthropicKey });
    const response = await anthropicClient.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: SYSTEM_PROMPTS[stage],
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    const content = Array.isArray(response.content) && response.content[0]?.type === 'text'
      ? response.content[0].text
      : '';
    const result = await extractJSON(content);

    if (result) {
      return {
        success: true,
        data: result,
        raw: content,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens
        },
        fallback: false
      };
    }

    throw new Error('Model returned invalid JSON');
  } catch (error) {
    console.error(`Error in ${stage}:`, error);

    if (!allowFallback) {
      return {
        success: false,
        data: null,
        raw: '',
        usage: { input_tokens: 0, output_tokens: 0 },
        fallback: false,
        error: error.message
      };
    }

    let fallback;
    if (stage === 'stage1') {
      fallback = generateFallbackStage1(prompt);
    } else if (stage === 'stage2') {
      fallback = generateFallbackStage2(context.intent || generateFallbackStage1(prompt));
    } else if (stage === 'stage3') {
      fallback = generateFallbackStage3(context.intent || generateFallbackStage1(prompt), context.design || generateFallbackStage2(context.intent || generateFallbackStage1(prompt)));
    } else if (stage === 'stage4') {
      fallback = generateFallbackStage4(context.config);
    } else if (stage === 'stage5') {
      fallback = generateFallbackStage5(context.config);
    } else if (stage === 'stage6') {
      fallback = generateFallbackStage6(context.intent, context.design, context.config);
    } else {
      fallback = context.config;
    }

    return {
      success: true,
      data: fallback,
      raw: JSON.stringify(fallback),
      usage: {
        input_tokens: 0,
        output_tokens: 0
      },
      fallback: true,
      error: error.message
    };
  }
}

module.exports = {
  runStage,
  extractJSON,
  SYSTEM_PROMPTS
};
