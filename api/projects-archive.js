// Vercel Serverless Function: POST /api/projects-archive
// Transitions an owned project active|paused|completed -> archived. Soft state
// change only; projects are never hard-deleted in Phase 1.

import { handleStatusTransition } from "../lib/projects/transition-handler.js";

export default async function handler(req, res) {
  return handleStatusTransition(req, res, "archived");
}
