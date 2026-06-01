// ZETU School Management System - Production Configuration
3	const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
4	
5	// Fallback to the provided Render URL if not local
6	window.API_BASE_URL = isLocal 
7	  ? "http://localhost:5000/api" 
8	  : "https://cbc-school-erp-api.onrender.com/api";
9	
