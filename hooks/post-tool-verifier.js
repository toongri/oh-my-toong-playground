// src/stdin.ts
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}
function parseInput(raw) {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
  }
  return {
    toolName: input.tool_name || input.toolName || "",
    toolOutput: input.tool_response || input.toolOutput || "",
    sessionId: input.session_id || input.sessionId || "unknown",
    cwd: input.cwd || input.directory || ""
  };
}

// src/stats.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
var STATE_FILE = path.join(os.homedir(), ".claude", ".session-stats.json");
function loadStats() {
  try {
    const content = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(content);
  } catch {
    return { sessions: {} };
  }
}
function saveStats(stats) {
  try {
    const dir = path.dirname(STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(stats, null, 2));
  } catch {
  }
}
function updateStats(toolName, sessionId) {
  const stats = loadStats();
  if (!stats.sessions[sessionId]) {
    stats.sessions[sessionId] = {
      tool_counts: {},
      last_tool: "",
      total_calls: 0,
      started_at: Math.floor(Date.now() / 1e3)
    };
  }
  const session = stats.sessions[sessionId];
  session.tool_counts[toolName] = (session.tool_counts[toolName] || 0) + 1;
  session.last_tool = toolName;
  session.total_calls = (session.total_calls || 0) + 1;
  session.updated_at = Math.floor(Date.now() / 1e3);
  saveStats(stats);
  return session.tool_counts[toolName];
}

// src/detectors.ts
var BASH_ERROR_PATTERNS = [
  /error:/i,
  /failed/i,
  /cannot/i,
  /permission denied/i,
  /command not found/i,
  /no such file/i,
  /exit code: [1-9]/i,
  /exit status [1-9]/i,
  /fatal:/i,
  /abort/i
];
var WRITE_ERROR_PATTERNS = [
  /error/i,
  /failed/i,
  /permission denied/i,
  /read-only/i,
  /not found/i
];
function detectBashFailure(output) {
  return BASH_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}
function detectWriteFailure(output) {
  return WRITE_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

// src/message-generator.ts
function generateMessage(toolName, toolOutput, _sessionId, toolCount) {
  if (toolName === "Bash") {
    if (detectBashFailure(toolOutput)) {
      return "Command failed. Please investigate the error and fix before continuing.";
    }
  } else if (toolName === "Edit") {
    if (detectWriteFailure(toolOutput)) {
      return "Edit operation failed. Verify file exists and content matches exactly.";
    }
  } else if (toolName === "Write") {
    if (detectWriteFailure(toolOutput)) {
      return "Write operation failed. Check file permissions and directory existence.";
    }
  } else if (toolName === "TodoWrite") {
    const outputLower = toolOutput.toLowerCase();
    if (/created|added/.test(outputLower)) {
      return "Todo list updated. Proceed with next task on the list.";
    } else if (/completed|done/.test(outputLower)) {
      return "Task marked complete. Continue with remaining todos.";
    } else if (/in_progress/.test(outputLower)) {
      return "Task marked in progress. Focus on completing this task.";
    }
  } else if (toolName === "Read") {
    if (toolCount > 10) {
      return `Extensive reading (${toolCount} files). Consider using Grep for pattern searches.`;
    }
  } else if (toolName === "Grep") {
    if (/^0$|no matches/.test(toolOutput)) {
      return "No matches found. Verify pattern syntax or try broader search.";
    }
  } else if (toolName === "Glob") {
    if (!toolOutput.trim() || /no files/.test(toolOutput.toLowerCase())) {
      return "No files matched pattern. Verify glob syntax and directory.";
    }
  }
  return "";
}

// src/index.ts
function buildResponse(toolName, toolOutput, toolCount) {
  const message = generateMessage(toolName, toolOutput, "", toolCount);
  const response = { continue: true };
  if (message) {
    response.hookSpecificOutput = {
      hookEventName: "PostToolUse",
      additionalContext: message
    };
  }
  return response;
}
async function main() {
  try {
    const raw = await readStdin();
    const input = parseInput(raw);
    const toolCount = updateStats(input.toolName, input.sessionId);
    const response = buildResponse(input.toolName, input.toolOutput, toolCount);
    process.stdout.write(JSON.stringify(response, null, 2));
  } catch {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}
main();
export {
  buildResponse
};
