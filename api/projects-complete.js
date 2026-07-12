import { handleStatusTransition } from "../lib/projects/transition-handler.js";

export default async function handler(req, res) {
  return handleStatusTransition(req, res, "completed");
}
