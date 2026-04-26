import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const requiredFiles = [
  'AGENTS.md',
  '.github/copilot-instructions.md',
  'docs/agentic/README.md',
  'docs/agentic/rule-set.md',
  'docs/agentic/memory.md',
];

async function exists(filePath) {
  try {
    await stat(path.join(root, filePath));
    return true;
  } catch {
    return false;
  }
}

async function ensureRequiredFiles() {
  const missing = [];
  for (const file of requiredFiles) {
    if (!(await exists(file))) {
      missing.push(file);
    }
  }

  if (missing.length) {
    throw new Error(`Missing required customization files:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  }
}

async function ensureDirectoryHasMatches(dir, suffix) {
  const fullDir = path.join(root, dir);

  if (!(await exists(dir))) {
    throw new Error(`Required directory '${dir}' does not exist. Create it and add at least one ${suffix} file.`);
  }

  const entries = await readdir(fullDir, { withFileTypes: true });
  const matches = entries.filter((entry) => entry.isFile() && entry.name.endsWith(suffix));

  if (!matches.length) {
    throw new Error(`Expected at least one ${suffix} file in ${dir}`);
  }
}

async function ensureSkillsValid() {
  const skillsDir = path.join(root, '.github/skills');
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory());

  if (!skillDirs.length) {
    throw new Error('Expected at least one skill directory in .github/skills');
  }

  for (const skillDir of skillDirs) {
    const skillPath = path.join(skillsDir, skillDir.name, 'SKILL.md');
    if (!(await exists(path.relative(root, skillPath)))) {
      throw new Error(`Missing SKILL.md for skill directory ${skillDir.name}`);
    }

    const content = await readFile(skillPath, 'utf8');
    const match = content.match(/^---\s*[\r\n]+name:\s*([a-z0-9-]+)\s*[\r\n]+description:/m);
    if (!match) {
      throw new Error(`Skill ${skillDir.name} must include YAML frontmatter with name and description`);
    }

    if (match[1] !== skillDir.name) {
      throw new Error(`Skill name '${match[1]}' must match directory '${skillDir.name}'`);
    }
  }
}

async function ensureRubberDuckReferenced() {
  const filesToCheck = [
    'AGENTS.md',
    'docs/agentic/README.md',
    'docs/agentic/rule-set.md',
  ];

  for (const file of filesToCheck) {
    const content = await readFile(path.join(root, file), 'utf8');
    if (!/rubber-duck/i.test(content)) {
      throw new Error(`Expected rubber-duck guidance in ${file}`);
    }
  }
}

await ensureRequiredFiles();
await ensureDirectoryHasMatches('.github/agents', '.agent.md');
await ensureDirectoryHasMatches('.github/prompts', '.prompt.md');
await ensureSkillsValid();
await ensureRubberDuckReferenced();

console.log('AI customization validation passed.');