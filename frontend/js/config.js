// ZETU School Management System - Production Configuration
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// Fallback to the provided Render URL if not local
window.API_BASE_URL = isLocal
  ? "http://localhost:5000/api"
  : "https://cbc-school-erp-api.onrender.com/api";
