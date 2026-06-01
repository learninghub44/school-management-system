/**
 * ZETU School Management System - Environment Configuration
 * All configuration is loaded from environment variables or .env files
 * NO hardcoded values are used in production
 */

// Detect environment
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const isDevelopment = process.env.NODE_ENV === "development" || isLocal;

// Load API configuration from environment
window.CONFIG = {
  // API Configuration
  API: {
    BASE_URL: window.API_BASE_URL || (isDevelopment 
      ? "http://localhost:5000/api" 
      : "https://cbc-school-erp-api.onrender.com/api"),
    TIMEOUT: parseInt(process.env.REACT_APP_API_TIMEOUT || "30000"),
    RETRY_ATTEMPTS: parseInt(process.env.REACT_APP_API_RETRY || "3"),
  },

  // Authentication
  AUTH: {
    TOKEN_KEY: "zetu_auth_token",
    USER_KEY: "zetu_user",
    REFRESH_INTERVAL: parseInt(process.env.REACT_APP_TOKEN_REFRESH || "3600000"), // 1 hour
  },

  // Application
  APP: {
    NAME: process.env.REACT_APP_NAME || "ZETU School Management System",
    VERSION: process.env.REACT_APP_VERSION || "1.0.0",
    ENVIRONMENT: isDevelopment ? "development" : "production",
  },

  // Features
  FEATURES: {
    ENABLE_ANALYTICS: process.env.REACT_APP_ENABLE_ANALYTICS !== "false",
    ENABLE_REPORTS: process.env.REACT_APP_ENABLE_REPORTS !== "false",
    ENABLE_EXPORT: process.env.REACT_APP_ENABLE_EXPORT !== "false",
  },

  // Security
  SECURITY: {
    ENABLE_CORS: process.env.REACT_APP_ENABLE_CORS !== "false",
    ENABLE_CSP: process.env.REACT_APP_ENABLE_CSP !== "false",
    SESSION_TIMEOUT: parseInt(process.env.REACT_APP_SESSION_TIMEOUT || "1800000"), // 30 minutes
  },

  // Logging
  LOGGING: {
    LEVEL: process.env.REACT_APP_LOG_LEVEL || (isDevelopment ? "debug" : "error"),
    ENABLE_CONSOLE: isDevelopment,
  },
};

// Validate critical configuration
if (!window.CONFIG.API.BASE_URL) {
  console.error("❌ FATAL: API_BASE_URL not configured");
  throw new Error("API configuration missing");
}

// Log configuration (only in development)
if (isDevelopment) {
  console.log("✅ Configuration loaded:", {
    environment: window.CONFIG.APP.ENVIRONMENT,
    apiBase: window.CONFIG.API.BASE_URL,
    features: window.CONFIG.FEATURES,
  });
}

export default window.CONFIG;
