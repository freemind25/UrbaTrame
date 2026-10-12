/* Runtime des fonctions Vercel.
   Volontairement HORS de api/ : tout fichier de ce dossier est déployé comme
   une fonction, et ce module n'en est pas une (il n'exporte aucun gestionnaire
   par défaut).
   Le module est évalué une fois par instance (réutilisé entre appels
   « chauds ») : licences, quota et sessions sont donc créés ici, et non à
   chaque requête. */
import { createRuntime } from './runtime.mjs';

export const runtime = createRuntime({ mode: 'vercel' });
