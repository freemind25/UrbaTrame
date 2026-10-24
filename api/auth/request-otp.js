/* POST /api/auth/request-otp — réponse anti-énumération; le code n'est jamais renvoyé au client. */
import { runtime } from '../../server/vercel.mjs';
import { clientIp } from '../../server/http.mjs';
import { createStudentAuthHandlers } from '../../server/student-auth-http.mjs';

const handlers = createStudentAuthHandlers(runtime.studentAuth);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return handlers.requestOtp(req, res, clientIp(req));
}
