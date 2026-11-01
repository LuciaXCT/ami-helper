// Local FastAPI mode can be connected via AMI_API_BASE_URL.
// Defaults to standalone demo mode so all focus timers, reminders, and chat work 100% in browser.
window.AMI_API_BASE_URL = window.AMI_API_BASE_URL || "";
window.AMI_STATIC_DEMO = window.AMI_STATIC_DEMO !== undefined ? window.AMI_STATIC_DEMO : true;
