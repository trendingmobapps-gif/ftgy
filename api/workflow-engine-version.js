import { getWorkflowEngineMetadata } from "../workflows/registry-metadata.js";

/**
 * Public metadata endpoint for workflow engine version checks.
 * Does not expose workflow definitions, prompts, or secrets.
 */
export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.status(200).json(getWorkflowEngineMetadata());
}
