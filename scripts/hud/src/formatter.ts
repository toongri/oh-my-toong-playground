import { ANSI, type HudData, type HudDataV2 } from './types.js';

function colorize(text: string, color: string): string {
  return `${color}${text}${ANSI.reset}`;
}

function getContextColor(percent: number): string {
  if (percent > 85) return ANSI.red;
  if (percent > 70) return ANSI.yellow;
  return ANSI.green;
}

function getRalphColor(iteration: number, max: number): string {
  if (iteration >= max) return ANSI.red;
  if (iteration > max * 0.7) return ANSI.yellow;
  return ANSI.green;
}

export function formatStatusLine(data: HudData): string {
  const parts: string[] = [];

  // Always show prefix
  parts.push(colorize('[OMT]', ANSI.bold));

  // Ralph status with verification
  if (data.ralph?.active) {
    const color = getRalphColor(data.ralph.iteration, data.ralph.max_iterations);
    let ralphText = `ralph:${data.ralph.iteration}/${data.ralph.max_iterations}`;

    // Add verification status if pending
    if (data.ralphVerification?.pending) {
      const v = data.ralphVerification;
      ralphText += ` \u2713${v.verification_attempts}/${v.max_verification_attempts}`;
    }

    parts.push(colorize(ralphText, color));
  }

  // Ultrawork status
  if (data.ultrawork?.active) {
    parts.push(colorize('ultrawork', ANSI.green));
  }

  // Context window percentage (most reliable)
  if (data.contextPercent !== null) {
    const percent = Math.min(100, Math.round(data.contextPercent));
    const color = getContextColor(percent);
    parts.push(colorize(`ctx:${percent}%`, color));
  }

  // Running agents
  if (data.runningAgents > 0) {
    parts.push(colorize(`agents:${data.runningAgents}`, ANSI.green));
  }

  // Background tasks
  if (data.backgroundTasks > 0) {
    parts.push(colorize(`bg:${data.backgroundTasks}`, ANSI.green));
  }

  // Todos completion
  if (data.todos) {
    const { completed, total } = data.todos;
    const color = completed === total ? ANSI.green : ANSI.yellow;
    parts.push(colorize(`todos:${completed}/${total}`, color));
  }

  // Active skill (truncate to 15 chars)
  if (data.activeSkill) {
    const skill = data.activeSkill.length > 15
      ? data.activeSkill.substring(0, 15)
      : data.activeSkill;
    parts.push(colorize(`skill:${skill}`, ANSI.green));
  }

  return parts.join(' | ');
}

export function formatMinimalStatus(contextPercent: number | null): string {
  const parts = [colorize('[OMT]', ANSI.bold)];

  if (contextPercent !== null) {
    const percent = Math.min(100, Math.round(contextPercent));
    const color = getContextColor(percent);
    parts.push(colorize(`ctx:${percent}%`, color));
  } else {
    parts.push('ready');
  }

  return parts.join(' ');
}

function getPercentColor(percent: number): string {
  if (percent > 85) return ANSI.red;
  if (percent > 70) return ANSI.yellow;
  return ANSI.green;
}

export function formatStatusLineV2(data: HudDataV2): string {
  const line1Parts: string[] = [];
  const line2Parts: string[] = [];

  // [OMT] - changed from [OMC]
  line1Parts.push(colorize('[OMT]', ANSI.bold));

  // Rate limits (only if available)
  if (data.rateLimits) {
    const parts: string[] = [];
    if (data.rateLimits.fiveHour) {
      const { percent, resetIn } = data.rateLimits.fiveHour;
      const color = getPercentColor(percent);
      parts.push(colorize(`5h:${percent}%(${resetIn})`, color));
    }
    if (data.rateLimits.sevenDay) {
      const { percent, resetIn } = data.rateLimits.sevenDay;
      const color = getPercentColor(percent);
      parts.push(colorize(`wk:${percent}%(${resetIn})`, color));
    }
    if (parts.length > 0) {
      line1Parts.push(parts.join(' '));
    }
  }

  // Context percentage
  if (data.contextPercent !== null) {
    const percent = Math.min(100, Math.round(data.contextPercent));
    const color = getContextColor(percent);
    line1Parts.push(colorize(`ctx:${percent}%`, color));
  }

  // Agent codes (e.g., agents:MsSh)
  if (data.agents.length > 0) {
    const codes = data.agents.map(a => `${a.type}${a.model}`).join('');
    line1Parts.push(colorize(`agents:${codes}`, ANSI.green));
  }

  // Ralph (only when active)
  if (data.ralph?.active) {
    const color = getRalphColor(data.ralph.iteration, data.ralph.max_iterations);
    let text = `ralph:${data.ralph.iteration}/${data.ralph.max_iterations}`;
    // Add + suffix when linked with ultrawork
    if (data.ralph.linked_ultrawork) {
      text += '+';
    }
    if (data.ralphVerification?.pending) {
      text += ` v${data.ralphVerification.verification_attempts}/${data.ralphVerification.max_verification_attempts}`;
    }
    line1Parts.push(colorize(text, color));
  }

  // Ultrawork (only when active and not linked to ralph)
  if (data.ultrawork?.active && !data.ultrawork.linked_to_ralph) {
    line1Parts.push(colorize('ultrawork', ANSI.green));
  }

  // Thinking indicator
  if (data.thinkingActive) {
    line1Parts.push(colorize('thinking', ANSI.cyan));
  }

  // Line 2: todos with in-progress task
  if (data.todos) {
    const { completed, total } = data.todos;
    const color = completed === total ? ANSI.green : ANSI.yellow;
    let todoText = `todos:${completed}/${total}`;
    if (data.inProgressTodo) {
      todoText += ` (${data.inProgressTodo})`;
    }
    line2Parts.push(colorize(todoText, color));
  }

  // Session duration
  if (data.sessionDuration !== null && data.sessionDuration > 0) {
    const hours = Math.floor(data.sessionDuration / 60);
    const mins = data.sessionDuration % 60;
    const formatted = hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
    line2Parts.push(colorize(`session:${formatted}`, ANSI.dim));
  }

  // Combine lines
  const line1 = line1Parts.join(' | ');
  const line2 = line2Parts.length > 0 ? line2Parts.join(' | ') : '';

  return line2 ? `${line1}\n${line2}` : line1;
}
