export function makeLogger(preElement, statusElement = null) {
  const lines = [];

  function push(level, message) {
    const line = `[${new Date().toLocaleTimeString()}] ${level} ${message}`;
    lines.push(line);
    while (lines.length > 120) lines.shift();
    if (preElement) preElement.textContent = lines.join("\n");
    if (statusElement) statusElement.textContent = message;
    console.log(line);
  }

  return {
    info(msg) { push("INFO", msg); },
    warn(msg) { push("WARN", msg); },
    error(msg) { push("ERR ", msg); }
  };
}
