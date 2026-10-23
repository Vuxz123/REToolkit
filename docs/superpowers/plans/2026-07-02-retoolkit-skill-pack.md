# REToolkit Skill Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create repo-local Codex skills that teach agents how to install REToolkit, run APK flow handoff, and use GhidraMCP analysis.

**Architecture:** Use three focused skills under `skills/` so trigger descriptions stay precise and agents load only the workflow they need. Keep each `SKILL.md` self-contained; no heavy references are needed because the repo already has README, Tutorial, and prompt docs.

**Tech Stack:** Markdown skill files with YAML frontmatter, `agents/openai.yaml` metadata from the official skill initializer, PowerShell command examples for REToolkit.

---

### Task 1: Scaffold Skills

**Files:**
- Create: `skills/retoolkit-install/SKILL.md`
- Create: `skills/retoolkit-flow/SKILL.md`
- Create: `skills/retoolkit-mcp-analysis/SKILL.md`
- Create: `skills/*/agents/openai.yaml`

- [x] **Step 1: Initialize each skill**

Run:

```powershell
python C:\Users\DPC00176\.codex\skills\.system\skill-creator\scripts\init_skill.py retoolkit-install --path skills
python C:\Users\DPC00176\.codex\skills\.system\skill-creator\scripts\init_skill.py retoolkit-flow --path skills
python C:\Users\DPC00176\.codex\skills\.system\skill-creator\scripts\init_skill.py retoolkit-mcp-analysis --path skills
```

Expected: each command creates a skill folder, `SKILL.md`, and `agents/openai.yaml`.

### Task 2: Write Skill Content

**Files:**
- Modify: `skills/retoolkit-install/SKILL.md`
- Modify: `skills/retoolkit-flow/SKILL.md`
- Modify: `skills/retoolkit-mcp-analysis/SKILL.md`

- [x] **Step 1: Replace templates**

Write frontmatter descriptions that start with `Use when...`, remove all TODO
text, and include the key REToolkit rules:

```text
MCP-first querying, repo-local skill import, flow GUI handoff, no ghidra-cli for normal analysis.
```

### Task 3: Update Prompt

**Files:**
- Modify: `prompts/install-ghidra-skill.md`

- [x] **Step 1: Add import instruction**

Insert a short section near the top telling agents to load the repo-local
skills directly when possible, or import/install `skills/retoolkit-install`,
`skills/retoolkit-flow`, and `skills/retoolkit-mcp-analysis` only when the
runtime requires installed skills.

### Task 4: Validate

**Files:**
- Inspect: `skills/**/SKILL.md`
- Inspect: `prompts/install-ghidra-skill.md`

- [x] **Step 1: Validate structure**

Run structural checks for frontmatter, TODO removal, key phrases, and git diff.
The official validator may be used if `PyYAML` is available.
