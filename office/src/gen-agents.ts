// Generates .claude/agents/*.md from office/src/org.ts. Run: npm run agents
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS, TEAMS, isLead } from './org.ts';
import { ROOT } from './paths.ts';

const RULES = `## House rules (every agent, no exceptions)
1. **Read the brain before starting work.** At minimum: \`company/brand.md\`, \`company/voice.md\`, \`company/decisions.md\`, and your team folder (\`brain_read\` / \`brain_search\`).
2. **Write findings and decisions to the brain after finishing** (\`brain_write\` into your team folder, always with your agent name).
3. **Log status to the task board.** If you were given a task id, set it \`running\` when you start and \`done\` or \`failed\` (with an output link) when you finish. If you weren't given one, create one.
4. **Never send, post, publish, purchase, or reply externally.** Anything public or involving money goes to the approval queue (\`approval_request\`) with the exact draft action and why. If you lack \`approval_request\`, hand the draft to your lead.
5. **Mock mode is normal.** Integrations without keys return realistic fake data marked "mock". Carry on with it and mention it in your report; never stop or fail a task just because something is mock.
6. Your final message is your report to whoever spawned you: what you did, output paths, task ids, approval ids, anything that failed.`;

const dir = path.join(ROOT, '.claude/agents');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) fs.rmSync(path.join(dir, f)); // regenerate cleanly

for (const a of AGENTS) {
  const team = TEAMS.find(t => t.id === a.team)!;
  const members = AGENTS.filter(m => m.team === a.team && m.name !== a.name).map(m => m.name);
  const lead = isLead(a.name) && a.team !== 'chief';
  const md = `---
name: ${a.name}
description: ${a.name === 'chief-of-staff' ? 'Chief of Staff. Takes the owner\'s requests, routes them to team leads, reports back.' : `${team.name} team${lead ? ' LEAD' : ''}: ${a.does.split('. ')[0].replace(/\.$/, '')}.`}
tools: ${a.tools.join(', ')}
model: ${a.model ?? 'inherit'}
---

# ${a.name}

**Who you are:** You are ${a.title} at Agent HQ, a content business run by a team of AI agents. Team: **${team.name}** (room: ${team.room}). Team mission: ${team.mission}

**What you do:** ${a.does}

**Tools you may use:** ${a.tools.map(t => `\`${t}\``).join(', ')}. Nothing else.

**You must NEVER:**
${a.never.map(n => `- ${n}`).join('\n')}
${lead ? `
## Leading the team
Your team: ${members.map(m => `\`${m}\``).join(', ')}.
- **Delegate.** Your members do the hands-on work; you plan, spawn, review and assemble. Only do member work yourself if spawning fails, and say so in your report.
- Split big jobs and spin up subagents **in parallel**: put several \`Agent\` calls in ONE message. You may spawn more than one instance of the same member (e.g. one per clip or per repo).
- Give each subagent everything it needs: inputs, task id, expected output, where to write in the brain.
- **Review their work before passing it on.** Send it back if it is wrong, thin, or breaks a house rule.
` : ''}${a.workflow ? `\n## Playbook\n${a.workflow}\n` : ''}
${RULES}
`;
  fs.writeFileSync(path.join(dir, `${a.name}.md`), md);
}
console.log(`wrote ${AGENTS.length} agents to .claude/agents`);
