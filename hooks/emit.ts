// Claude Code hook: turns PreToolUse/PostToolUse/SubagentStart/SubagentStop/Stop into office events.
// Runs async (see .claude/settings.json) and never blocks or fails a tool call.
import { logEvent } from '../office/src/db.ts';
import { toolLabel } from '../office/src/labels.ts';

const TYPES: Record<string, string> = {
  PreToolUse: 'tool_start', PostToolUse: 'tool_end', PostToolUseFailure: 'tool_end',
  SubagentStart: 'agent_start', SubagentStop: 'agent_stop', SessionStart: 'session_start', Stop: 'session_stop',
};

try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const h = JSON.parse(raw);
  const type = TYPES[h.hook_event_name];
  if (type) {
    const tool: string | undefined = h.tool_name;
    logEvent({
      type,
      agent: h.agent_type ?? process.env.OFFICE_AGENT ?? 'chief-of-staff',
      tool,
      label: tool ? toolLabel(tool, h.tool_input) : h.hook_event_name,
      session: h.session_id,
      instance: h.agent_id ?? h.session_id,
      data: tool ? { input: h.tool_input, tool_use_id: h.tool_use_id } : { last: h.last_assistant_message?.slice?.(0, 500) },
    });
  }
} catch (e) {
  process.stderr.write(`office hook: ${e}\n`);
}
