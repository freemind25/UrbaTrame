/* Runtime partagé par les fonctions Vercel.
   Le module est évalué une fois par instance (réutilisé entre appels
   « chauds ») : licences, quota et sessions sont donc créés ici, et non à
   chaque requête. */
import { createRuntime } from '../../server/runtime.mjs';

export const runtime = createRuntime({ mode: 'vercel' });
