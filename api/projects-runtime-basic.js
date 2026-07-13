// Preview-only basic runtime probe. No Project Brain imports.

console.log("[projects-runtime-basic] module_loaded");

export default async function handler(req, res) {
  console.log("[projects-runtime-basic] handler_started");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ success: false, error: { message: "Method not allowed. Use GET or POST." } });
    return;
  }

  res.status(200).json({
    success: true,
    runtime: process.version,
  });
}
