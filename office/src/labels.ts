// Speech-bubble text for the dashboard: what an agent is doing, in plain words.
const LABELS: Record<string, string> = {
  brain_read: 'reading the brain', brain_write: 'writing to the brain', brain_search: 'searching the brain',
  task_create: 'posting a task', task_update: 'updating the board', task_list: 'checking the board',
  approval_request: 'filing for approval', approval_list: 'checking approvals',
  media_probe: 'inspecting footage', media_frame: 'studying a frame', media_cut: 'cutting the clip', media_transcribe: 'transcribing audio',
  media_burn_captions: 'burning captions', media_thumbnail: 'drawing a thumbnail', media_resize: 'resizing video',
  media_music_list: 'browsing the music library', media_add_music: 'laying in music',
  generation_models: 'browsing AI video models', generation_request: 'pricing an AI shot', generation_status: 'checking AI renders',
  search_repositories: 'searching GitHub', get_repo: 'sizing up a repo', get_readme: 'reading a README',
  drive_list_files: 'checking Drive', drive_download: 'pulling clips from Drive',
  calendar_list_events: 'reading the calendar', calendar_free_slots: 'finding a time slot',
  slack_notify: 'pinging Slack', gmail_search: 'sorting the mail', gmail_read: 'reading an email', gmail_create_draft: 'drafting a reply',
  shop_list_orders: 'checking orders', shop_list_listings: 'reviewing listings', shop_list_tickets: 'reading tickets',
  analytics_post_stats: 'crunching numbers', analytics_channel_summary: 'reading the ledger',
  Agent: 'briefing the team', Task: 'briefing the team', Read: 'reading files', Write: 'writing a file', Edit: 'editing code',
  Grep: 'searching code', Glob: 'looking for files', Bash: 'running a command', WebSearch: 'searching the web', WebFetch: 'reading a web page',
};

export function toolLabel(tool: string, input: any = {}) {
  const short = tool.split('__').pop()!; // mcp__office__brain_read -> brain_read
  if ((short === 'Agent' || short === 'Task') && input.subagent_type) return `briefing ${input.subagent_type}`;
  if (short === 'Bash' && typeof input.command === 'string') return `$ ${input.command.slice(0, 40)}`;
  return LABELS[short] ?? short.replace(/_/g, ' ');
}
