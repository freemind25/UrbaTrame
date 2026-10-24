/* POST /api/auth/logout — révoque la session et supprime le cookie. */
import { runtime } from '../../server/vercel.mjs';
import { createStudentAuthHandlers } from '../../server/student-auth-http.mjs';

const handlers = createStudentAuthHandlers(runtime.studentAuth);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return handlers.logout(req, res);
}
