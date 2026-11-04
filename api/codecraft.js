/* CodeCraft relay handler — forwards CodeCraft API requests through the server to keep the key secret */
import { createApi } from '../server/api.mjs';
import { runtime } from '../server/vercel.mjs';

const handle = createApi(runtime.studentAuth);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return handle(req, res);
}