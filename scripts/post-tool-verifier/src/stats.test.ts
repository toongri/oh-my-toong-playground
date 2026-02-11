import { updateStats } from './stats.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const STATE_FILE = path.join(os.homedir(), '.claude', '.session-stats.json');

describe('updateStats', () => {
  let originalContent: string | null = null;

  beforeEach(() => {
    // Save original state file if it exists
    try {
      originalContent = fs.readFileSync(STATE_FILE, 'utf8');
    } catch {
      originalContent = null;
    }
    // Clean state for each test
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {
      // File might not exist
    }
  });

  afterEach(() => {
    // Restore original state file
    try {
      if (originalContent !== null) {
        fs.writeFileSync(STATE_FILE, originalContent);
      } else {
        fs.unlinkSync(STATE_FILE);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates a new session entry and returns count 1 for first tool use', () => {
    const count = updateStats('Bash', 'test-session-1');

    expect(count).toBe(1);

    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.sessions['test-session-1']).toBeDefined();
    expect(data.sessions['test-session-1'].tool_counts['Bash']).toBe(1);
  });

  it('increments count for repeated tool use in same session', () => {
    updateStats('Bash', 'test-session-2');
    updateStats('Bash', 'test-session-2');
    const count = updateStats('Bash', 'test-session-2');

    expect(count).toBe(3);
  });

  it('tracks different tools independently within a session', () => {
    updateStats('Bash', 'test-session-3');
    updateStats('Edit', 'test-session-3');
    const bashCount = updateStats('Bash', 'test-session-3');

    expect(bashCount).toBe(2);

    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.sessions['test-session-3'].tool_counts['Edit']).toBe(1);
  });

  it('tracks different sessions independently', () => {
    updateStats('Bash', 'session-a');
    updateStats('Bash', 'session-b');

    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.sessions['session-a'].tool_counts['Bash']).toBe(1);
    expect(data.sessions['session-b'].tool_counts['Bash']).toBe(1);
  });

  it('tracks total_calls across tools', () => {
    updateStats('Bash', 'test-session-4');
    updateStats('Edit', 'test-session-4');
    updateStats('Read', 'test-session-4');

    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.sessions['test-session-4'].total_calls).toBe(3);
  });

  it('records last_tool used', () => {
    updateStats('Bash', 'test-session-5');
    updateStats('Edit', 'test-session-5');

    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.sessions['test-session-5'].last_tool).toBe('Edit');
  });

  it('handles corrupted state file gracefully', () => {
    fs.writeFileSync(STATE_FILE, 'not json');

    const count = updateStats('Bash', 'test-session-6');

    expect(count).toBe(1);
  });
});
