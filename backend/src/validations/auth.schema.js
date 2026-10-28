/**
 * @file auth.schema.js
 * @description Zod validation schemas for authentication endpoints.
 */

const { z } = require('zod');

/** Join bəzən string "true" göndərir; Zod boolean olmayanda wantsSolo itirdi. */
const optionalBoolish = z.preprocess((v) => {
  if (v === undefined || v === null) return undefined;
  if (v === true || v === false) return v;
  if (v === 'true' || v === '1' || v === 1) return true;
  if (v === 'false' || v === '0' || v === 0) return false;
  return undefined;
}, z.boolean().optional());

/** Match join-page normalization so bare paths like github.com/foo validate. */
function normalizeGithubInput(val) {
  if (val === undefined || val === null) return undefined;
  const s = String(val).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const stripped = s.replace(/^(www\.)?github\.com\/+/i, '').replace(/^\/+/, '');
  return `https://github.com/${stripped}`;
}

function normalizeLinkedInInput(val) {
  if (val === undefined || val === null) return undefined;
  const s = String(val).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const stripped = s
    .replace(/^(www\.)?linkedin\.com\/+/i, '')
    .replace(/^in\/+/i, '')
    .replace(/^\/+/, '');
  return `https://www.linkedin.com/in/${stripped}`;
}

const optionalUrlOrEmpty = z.union([
  z.literal(''),
  z.string().url(),
]);

const registerSchema = z.object({
  fullName: z.string()
    .min(2, 'Full name must be at least 2 characters')
    .refine((val) => !/[<>]/.test(val), { message: 'Invalid characters in name. < and > are not allowed.' }),
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/\d/, 'Password must contain at least one number'),
  /** Frontend: event-in rəqəmsal id-si (POST body). Dəvət varsa rol dəvətdən; yoxdursa hacker. */
  eventId: z.union([z.number(), z.string()]).optional(),
  /** JSON snake_case alias (əks halda Zod silir, dəvət tapılmır). */
  event_id: z.union([z.number(), z.string()]).optional(),
  /** Köhnə / alternativ: event kodu (məs. HACK2026). eventId ilə eyni məntiq. */
  eventCode: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().min(1).optional(),
  ),
  githubLink: z.preprocess(
    normalizeGithubInput,
    optionalUrlOrEmpty.optional(),
  ),
  linkedin: z.preprocess(
    normalizeLinkedInInput,
    optionalUrlOrEmpty.optional(),
  ),
  /** Solo qeydiyyat (join səhifəsi) — backend participants sətri yaradır. */
  isSolo: optionalBoolish,
  is_solo: optionalBoolish,
  registrationType: z.string().optional(),
  /** Client sends role; server ignores it — allow through so join payload validates. */
  role: z.string().optional(),
  /** Join / extended registration — must be in schema or Zod strips them before registerUser(). */
  phone: z.union([z.string(), z.number()]).optional(),
  age: z.union([z.number(), z.string()]).optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  attendanceMode: z.string().optional(),
  attendance_mode: z.string().optional(),
  university: z.string().optional(),
  cohort: z.string().optional(),
  skills: z.union([z.array(z.string()), z.string()]).optional(),
  experience: z.string().optional(),
  rolePreference: z.string().optional(),
  role_preference: z.string().optional(),
  dietary: z.string().optional(),
  tshirtSize: z.string().optional(),
  tshirt_size: z.string().optional(),
  motivation: z.string().optional(),
  howHeard: z.string().optional(),
  how_heard: z.string().optional(),
  /** The token from an event invitation's link (inviteToken.js). */
  inviteToken: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().max(200).optional(),
  ),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

/** Shared password policy (register / reset / change). */
const passwordRule = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be 128 characters or fewer')
  .regex(/\d/, 'Password must contain at least one number');

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(16, 'Invalid reset token'),
  password: passwordRule,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordRule,
});

const setPasswordSchema = z.object({
  password: passwordRule,
});

module.exports = {
  registerSchema,
  loginSchema,
  passwordRule,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  setPasswordSchema,
};
