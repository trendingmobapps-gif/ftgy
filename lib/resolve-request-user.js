// Shared request-identity helper.
// For Projects, ownership is ALWAYS the authenticated Supabase user UUID passed
// as `memberId` (which equals projects.user_id). Email is accepted only for
// compatibility/logging and is never used to determine ownership.
//
// If/when Supabase JWT verification is added upstream, the verified `sub`
// should be passed in as `verifiedUserId` and this helper confirms it matches
// `memberId`.

import { isValidUuid } from "./projects/validation.js";

function normalizeEmail(email) {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

// Resolves the authoritative request user.
// Returns:
//   { ok: true, userId, email }
//   { ok: false, status, code, message }
export function resolveRequestUser(body, options = {}) {
  const input = body && typeof body === "object" ? body : {};
  const { verifiedUserId = null } = options;

  const memberIdRaw =
    typeof input.memberId === "string" && input.memberId.trim()
      ? input.memberId.trim()
      : typeof input.wixMemberId === "string" && input.wixMemberId.trim()
        ? input.wixMemberId.trim()
        : "";

  const email = normalizeEmail(input.email);

  if (!memberIdRaw) {
    return {
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Utilizator neidentificat.",
    };
  }

  if (!isValidUuid(memberIdRaw)) {
    return {
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Identificator utilizator invalid.",
    };
  }

  // When a verified JWT subject is provided, it must match memberId.
  if (verifiedUserId && verifiedUserId !== memberIdRaw) {
    return {
      ok: false,
      status: 401,
      code: "PROJECT_UNAUTHENTICATED",
      message: "Utilizatorul nu corespunde sesiunii autentificate.",
    };
  }

  return {
    ok: true,
    userId: memberIdRaw,
    email: email || null,
  };
}
