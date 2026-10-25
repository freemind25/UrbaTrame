/* GET vérifie la session; POST authentifie le propriétaire sans OTP étudiant. */
import { runtime } from '../../server/vercel.mjs';
import { clientIp } from '../../server/http.mjs';
import { createStudentAuthHandlers } from '../../server/student-auth-http.mjs';

const handlers = createStudentAuthHandlers(runtime.studentAuth);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') return handlers.ownerLogin(req, res, clientIp(req));
  return handlers.session(req, res);
}
