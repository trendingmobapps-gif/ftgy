// Vercel Serverless Function: POST /api/projects-pause
// Transitions an owned project active -> paused.

import { handleStatusTransition } from "../lib/projects/transition-handler.js";

export default async function handler(req, res) {
  return handleStatusTransition(req, res, "paused");
}
