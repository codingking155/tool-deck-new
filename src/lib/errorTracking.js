/* Lightweight error tracking without external dependencies
   Captures JS errors, unhandled rejections, and logs them for debugging */

const ERROR_LOG_KEY = "toolDeck.errors";
const MAX_ERRORS = 50;

function getErrorLog() {
  try {
    const stored = localStorage.getItem(ERROR_LOG_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveErrorLog(errors) {
  try {
    const trimmed = errors.slice(-MAX_ERRORS);
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or unavailable */
  }
}

export function logError(error, context = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    message: error?.message || String(error),
    stack: error?.stack || "",
    context,
    url: window.location.href,
    userAgent: navigator.userAgent,
  };

  const log = getErrorLog();
  log.push(entry);
  saveErrorLog(log);

  /* Log to console in dev mode */
  if (process.env.NODE_ENV !== "production") {
    console.error("[ToolDeck Error]", entry);
  }

  return entry;
}

export function getErrors() {
  return getErrorLog();
}

export function clearErrorLog() {
  try {
    localStorage.removeItem(ERROR_LOG_KEY);
  } catch {
    /* ignore */
  }
}

/* Global error handlers */
export function setupErrorTracking() {
  /* Catch unhandled JS errors */
  window.addEventListener("error", (event) => {
    logError(event.error, {
      type: "uncaught-error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  /* Catch unhandled promise rejections */
  window.addEventListener("unhandledrejection", (event) => {
    logError(event.reason, {
      type: "unhandled-rejection",
    });
  });

  /* Monitor console.error calls */
  const originalError = console.error;
  console.error = function (...args) {
    const error = args[0];
    if (error instanceof Error) {
      logError(error, { type: "console-error" });
    }
    originalError.apply(console, args);
  };
}

/* Performance monitoring */
export function logPerformance(toolId, duration, success = true) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    type: "performance",
    toolId,
    duration,
    success,
  };

  try {
    const log = getErrorLog();
    log.push(entry);
    saveErrorLog(log);
  } catch {
    /* ignore */
  }
}
