/* GET /api/auth/session — retourne uniquement l'état de session et le palier. */
import { runtime } from '../../server/vercel.mjs';
import { createStudentAuthHandlers } from '../../server/student-auth-http.mjs';

const handlers = createStudentAuthHandlers(runtime.studentAuth);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return handlers.session(req, res);
}
