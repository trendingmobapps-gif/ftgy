// Vercel Serverless Function: POST /api/projects-complete
// Transitions an owned project active|paused -> completed. No completion
// summaries are generated in Phase 1.

import { handleStatusTransition } from "../lib/projects/transition-handler.js";

export default async function handler(req, res) {
  return handleStatusTransition(req, res, "completed");
}
