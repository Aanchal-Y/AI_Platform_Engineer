import React, { useState } from 'react';

function CompilerForm({ onCompile, loading }) {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim()) {
      onCompile(prompt);
    }
  };

  const baseSuggestions = [
    'Build a CRM with login, contacts, dashboard, role-based access, and a premium plan with payments.',
    'Create a task management app with teams, projects, tasks, comments, and notifications.',
    'Build a blogging platform where authors write posts, readers comment, and admins moderate content.',
    'Create a fitness tracker with workouts, exercises, progress charts, and social sharing.',
    'Build a small e-commerce store with products, cart, checkout, order history, and seller dashboard.',
    'Create a recipe sharing app with user profiles, ratings, comments, and search filters.',
    'Design a project management tool with kanban boards, sprints, and team permissions.',
    'Build an event booking system with event listings, ticketing, calendars, and reminders.',
    'Create a customer support helpdesk with tickets, agent assignment, SLAs, and reporting.',
    'Build a SaaS subscription billing dashboard with plans, invoices, and usage metering.',
    'Create a social network focused on interest groups, posts, private messaging, and follow feeds.',
    'Build an online learning platform with courses, lessons, quizzes, and student progress tracking.',
    'Create a property listings site with search filters, agent contact, and saved favorites.',
    'Build a healthcare appointment scheduler with providers, availability, and patient records.',
    'Create a collaborative document editor with permissions, versioning, and comments.',
    'Build a personal finance tracker with accounts, transactions, budgets, and reports.',
    'Create a bug tracker with issues, labels, milestones, and assignees.',
    'Build a marketplace for freelancers with profiles, proposals, contracts, and reviews.',
    'Create an inventory management system with suppliers, stock levels, and purchase orders.',
    'Build a location-based discovery app for restaurants, reviews, maps, and reservations.'
  ];

  const evalSuggestions = [
    'Build a CRM with login, contacts, dashboard, role-based access, and a premium plan with payments. Admins can see analytics.',
    'Create a task management app with teams, projects, tasks, comments, and notifications.',
    'Build a blogging platform where authors write posts, readers comment, and admins moderate content.',
    'Create a fitness tracker with workouts, exercises, progress charts, and social sharing among friends.',
    'Build a small e-commerce site with products, cart, checkout, order history, and seller dashboard.',
    'An internal HR portal: employee records, leave requests, payroll, and manager approvals.',
    'Recipe sharing app: users upload recipes, others rate and favorite, filters by dietary preference.',
    'SaaS billing dashboard: subscriptions, invoices, usage metering, and per-seat pricing tiers.',
    'Real estate listings: properties, search with filters, contact agent, schedule a tour.',
    'Customer support helpdesk: tickets, agent assignment, SLA tracking, and analytics dashboard for managers.',
    'Make me an app',
    'Something for productivity',
    'Build a public forum with strict admin-only posting',
    'A completely free service where every feature requires payment',
    'I need users to log in'
  ];

  const suggestions = Array.from(new Set([...baseSuggestions, ...evalSuggestions]));

  return (
    <div className="compiler-form-container">
      <div className="form-section">
        <h2>Describe Your Application</h2>
        <form onSubmit={handleSubmit}>
          <textarea
            className="prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your app in natural language..."
            rows={6}
          />
          <button type="submit" disabled={loading || !prompt.trim()} className="compile-btn">
            {loading ? 'Compiling...' : 'Compile'}
          </button>
        </form>
      </div>

      <div className="suggestions-section">
        <h3>Example Prompts</h3>
        <ul>
          {suggestions.map((suggestion, idx) => (
            <li key={idx}>
              <button
                className="suggestion-btn"
                onClick={() => setPrompt(suggestion)}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default CompilerForm;
