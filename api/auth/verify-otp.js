/* POST /api/auth/verify-otp — valide l'OTP et pose un cookie de session HttpOnly. */
import { runtime } from '../../server/vercel.mjs';
import { createStudentAuthHandlers } from '../../server/student-auth-http.mjs';

const handlers = createStudentAuthHandlers(runtime.studentAuth);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return handlers.verifyOtp(req, res);
}
