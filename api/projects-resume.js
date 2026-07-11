// Vercel Serverless Function: POST /api/projects-resume
// Transitions an owned project paused -> active.

import { handleStatusTransition } from "../lib/projects/transition-handler.js";

export default async function handler(req, res) {
  return handleStatusTransition(req, res, "active");
}
