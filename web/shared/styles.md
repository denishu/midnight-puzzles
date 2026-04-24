# Shared UI Design Tokens

Consistent styles across all 3 game UIs (Travle, Semantle, Duotrigordle).

## Font

```css
/* Load Inter from Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* Font stack */
font-family: 'Inter', system-ui, sans-serif;
```

## Colors

```css
/* Background */
--bg-primary: #0a0e1a;
--bg-secondary: #111827;
--bg-surface: rgba(15, 23, 42, 0.95);

/* Text */
--text-primary: #f1f5f9;
--text-secondary: #94a3b8;
--text-muted: #64748b;

/* Accent (green — used for buttons, success) */
--accent: #4ade80;
--accent-dark: #22c55e;
--accent-text: #052e16;

/* Game colors */
--color-green: #22c55e;
--color-yellow: #eab308;
--color-red: #ef4444;
--color-neutral: #60a5fa;

/* Borders */
--border-subtle: rgba(59, 130, 246, 0.15);
--border-accent: rgba(59, 130, 246, 0.2);

/* Shadows */
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
```

## Common Patterns

```css
/* Input fields */
input {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-accent);
  background: rgba(15, 23, 42, 0.6);
  color: var(--text-primary);
  font-size: 14px;
  font-family: 'Inter', system-ui, sans-serif;
}

/* Primary button */
button.primary {
  padding: 12px 20px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, var(--accent), var(--accent-dark));
  color: var(--accent-text);
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Overlay/popup */
.overlay {
  background: var(--bg-surface);
  border: 1px solid var(--border-accent);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
}
```
