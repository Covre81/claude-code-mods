import { PluginHooks } from '@claude-code/types';
import { looksLikeRule } from './reflexo.test';

let queuedRule: string | null = null;
let enabled = true;

export async function onSessionStart($, next: any) {
  $.ui.status(`reflexo: ${enabled ? 'on' : 'off'}`);
  return next();
}

export async function onPromptSubmit($, next: any) {
  try {
    const { text } = $.prompt;
    if (enabled && looksLikeRule(text)) {
      queuedRule = text;
    }
  } catch (e) {
    // ponytail: fail-open
    return next(e);
  }
  return next();
}

export async function onTurnComplete($, next: any) {
  try {
    if (!queuedRule) return next();

    const rule = queuedRule;
    queuedRule = null; // Clear before asking to avoid double-prompts on fast turns

    const answer = await $.ui.ask({
      question: 'Salvar como regra?',
      options: ['Projeto (CLAUDE.md)', 'Global (~/.claude/CLAUDE.md)', 'Ignorar'],
    });

    if (!answer || answer === 'Ignorar') {
      return next();
    }

    const filePath = answer === 'Projeto (CLAUDE.md)'
      ? $.fs.cwd + '/CLAUDE.md'
      : $.fs.home + '/.claude/CLAUDE.md';

    await appendRule($, filePath, rule);
  } catch (e) {
    // ponytail: fail-open
    return next(e);
  }
  return next();
}

async function appendRule($, filePath: string, rule: string) {
  try {
    const content = await $.fs.read(filePath).catch(() => '');
    const heading = '## Regras capturadas';

    let newContent;
    if (content.includes(heading)) {
      newContent = content.replace(heading, `${heading}\n- ${rule}`);
    } else {
      newContent = content + (content ? '\n\n' : '') + `${heading}\n- ${rule}`;
    }

    await $.fs.write(filePath, newContent);
  } catch (e) {
    // ponytail: swallow error in fail-open
  }
}

export async function onSlashCommand($, next: any) {
  try {
    const { command } = $.prompt;
    if (command === 'reflexo') {
      const arg = $.prompt.args[0];
      if (arg === 'on') {
        enabled = true;
        $.ui.status('reflexo: on');
      } else if (arg === 'off') {
        enabled = false;
        $.ui.status('reflexo: off');
      } else {
        $.ui.status(`reflexo: ${enabled ? 'on' : 'off'}`);
      }
      return next();
    }
  } catch (e) {
    return next(e);
  }
  return next();
}
