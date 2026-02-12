# Shadow QA — Project Guide (CLAUDE.md)

## Project Overview

**Shadow QA** is a frontend regression detection tool that compares two versions of a web page and identifies **unintended visual, structural, and accessibility changes**, explaining **why they matter to users**.

The goal is not just to detect differences, but to **surface meaningful regressions with clear human-readable impact**.

This project is designed as a **portfolio-quality system**, prioritizing clarity, judgment, and real-world relevance over feature breadth.

---

## Core Principles

1. **Explain impact, not just differences**
   - Every finding must answer: *Who is affected and how?*

2. **Opinionated over configurable**
   - Prefer sensible defaults instead of endless toggles.

3. **Human-readable first**
   - Reports should be understandable by a developer in under 1 minute.

4. **Signal > coverage**
   - Fewer, high-value checks are better than exhaustive noise.

5. **No CI, no auth, no teams (for MVP)**
   - This is a standalone comparison tool first.

---

## MVP Scope (Strict)

### Inputs
- Two versions of a page:
  - URL-to-URL comparison (primary)
- Viewport:
  - Desktop only for MVP

### Outputs
- A comparison report containing:
  - Visual regressions
  - DOM structure regressions
  - Accessibility regressions
  - Severity classification
  - Human-readable explanations

---

## MVP Features

### 1. Visual Regression Detection
Detect meaningful visual changes such as:
- Element moved significantly
- Element resized
- Element removed or added
- Color/contrast changes affecting readability

**Out of scope:**
- Pixel-perfect diffs
- Tolerance sliders
- Multi-browser rendering

---

### 2. DOM Structure Diffing
Compare normalized DOM trees to detect:
- Element added / removed
- Tag changes (e.g. `button → div`)
- Attribute changes affecting behavior
- Visibility changes (`display`, `hidden`, etc.)

---

### 3. Accessibility Regression Checks
Use `axe-core` or equivalent to detect:
- Missing accessible names
- Focusability issues
- Role removals
- Basic contrast regressions

Accessibility findings are **first-class citizens**, not secondary checks.

---

### 4. Severity Scoring

Each finding must include:
- `severity`: `critical | major | minor | cosmetic`
- `confidence`: number between `0` and `1`

Severity is determined by:
- Impact on interaction
- Impact on accessibility
- Visibility to users
- Likelihood of being unintended

---

### 5. Explanation Layer (Critical)

Every finding must include:
- **What changed**
- **Why it matters**
- **Who is affected**
- **Suggested next action**

Raw diffs without explanation are not acceptable.

---

## Data Model (Canonical Shape)

All findings must conform to this structure:

```json
{
  "id": "string",
  "category": "visual | dom | accessibility",
  "severity": "critical | major | minor | cosmetic",
  "confidence": 0.0,
  "title": "Short human-readable summary",
  "description": "What changed",
  "impact": "Why this matters to users",
  "recommendation": "Suggested fix or investigation",
  "element": {
    "selector": "string",
    "tag": "string"
  },
  "before": "string",
  "after": "string"
}
