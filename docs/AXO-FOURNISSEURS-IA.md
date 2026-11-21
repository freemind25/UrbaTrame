# Assistance IA de la planche axonométrique éclatée

La carte « Analyse axonométrique éclatée » contient un panneau optionnel d'assistance **textuelle**. Le registre partagé `public/js/axo-ai-providers.mjs` énumère explicitement les destinations HTTPS de onze fournisseurs : OpenRouter, Groq, Agnes AI, Mistral AI, CodeCraft API, Z.ai (API standard), AgentRouter, Gemini (compatibilité OpenAI), Kira AI, APInex et RoutesMe (API standard /v1). Pour chaque fournisseur, une liste d'exemples d'identifiants textuels est proposée ; on peut aussi saisir un autre ID exact. Ces exemples sont statiques, non exhaustifs, et ne sont pas le catalogue personnel du compte. Ils peuvent devenir obsolètes ou payants : vérifier disponibilité, droits et tarifs sur le lien du fournisseur. Aucun modèle n'est sélectionné automatiquement et aucun catalogue en ligne n'est interrogé par le panneau. Le module ne vérifie pas les modèles ni les tarifs en direct, ne sélectionne pas automatiquement un modèle gratuit et ne bascule pas vers un autre fournisseur.

## Offres gratuites : à vérifier avant usage

OpenRouter propose `openrouter/free`, un routeur vers un modèle gratuit variable, et des variantes `:free`, dont `nvidia/nemotron-3-ultra-550b-a55b:free` (catalogue susceptible de changer). La version sans `:free` peut être payante. Le relais transmet seulement l'identifiant choisi, sans liste de repli payant. Les quotas et la politique de données de son compte s'appliquent ; https://openrouter.ai/docs/guides/routing/routers/free-router.

Groq propose un plan gratuit avec quota, différent du plan Developer payant ; consulter https://console.groq.com/settings/billing et https://console.groq.com/docs/rate-limits. Gemini propose un niveau gratuit sur certains modèles et comptes, distinct du plan payant : https://ai.google.dev/gemini-api/docs/pricing. Un exemple affiché ne garantit ni éligibilité, ni service, ni gratuité, et aucun tarif n'est vérifié en direct. L'application ne fournit pas de clé et ne stocke pas la clé dans le panneau.

Cloudflare Workers AI n'est pas intégré ici : ses URL d'API dépendent du compte ; le relais n'autorise que des destinations fixes et ne doit pas accepter une URL arbitraire. Kira et Mistral nécessitent une vérification du plan et de la disponibilité de l'API. Les réponses sont purement textuelles ; les IA ne produisent pas ici une planche ni des géométries.

Z.ai est configuré sur son endpoint API standard. Les conditions et l'endpoint du GLM Coding Plan sont distincts : ce prototype ne les utilise pas. Les accès CodeCraft via un relais hébergé ont déjà rencontré un blocage WAF (403) dans le projet ; il est signalé et n'est pas contourné automatiquement. Les routeurs peuvent transmettre les données à un fournisseur d'inférence tiers : examiner leurs conditions avant l'envoi. Gemini est branché via son interface de compatibilité OpenAI, pas son API native.

RoutesMe est configuré selon l'endpoint standard /v1 documenté sur https://routesme.online/. L'endpoint /v2 est annoncé pour l'offre VIP et n'est pas configuré ici. Ne pas confondre ce service avec `www.routeme.ai`, consacré à la navigation intérieure.

## Clé et données

Le demandeur fournit sa clé personnelle dans le panneau ; celle-ci n'est pas enregistrée par ce module et le champ est vidé lors de l'envoi. Changer de fournisseur efface également la clé, le consentement et la réponse précédente, afin d'éviter de transmettre la clé d'un service à un autre. La clé transite vers le serveur UrbaTrame dans l'en-tête Authorization, puis vers le fournisseur choisi via HTTPS ; les installations, relais et journaux d'infrastructure doivent être sécurisés. Ne jamais envoyer une clé par message ou la placer dans le code du dépôt.

Après consentement et confirmation récapitulative précisant la destination, le résumé transmis comprend le nom, les coordonnées, le rayon et la forme du site, les nombres d'objets OSM chargés et les observations saisies. Aucun objet géométrique, attribut individuel, fichier ou photo n'est transmis automatiquement ; les observations saisies sont toutefois transmises telles quelles. Les comptages concernent les données chargées, pas nécessairement uniquement la zone visible. Les conditions de traitement et la facturation dépendent du fournisseur choisi. Ne transmettre que des données qu'on est autorisé à partager.

Le serveur n'accepte que les URL fixes du registre, interdit les redirections, limite la requête et la réponse, ne journalise pas le prompt ni la clé et impose un court quota par IP en mémoire par instance. Ce quota n'est pas une protection distribuée pour la production ; l'authentification étudiante existante est exigée si elle est activée. Le relais consomme des ressources serveur ; renforcer la limitation et la surveillance avant ouverture publique. La protection contre les abus est à revoir en cas de clé commune ou de déploiement multi-instances.

Le modèle est invité à distinguer faits et hypothèses, sans inventer de tracés. Sa réponse est du texte non validé, sans ajout automatique à la carte. Les comptages ne permettent pas de localiser les barrières ou les directions de développement ; un enrichissement à partir d'objets sourcés, la vérification humaine et l'édition de flèches sont des travaux ultérieurs. Les API de génération d'images ne sont pas intégrées ici.

## Références des endpoints

- OpenRouter : https://openrouter.ai/docs
- Groq : https://console.groq.com/docs/openai
- Agnes : https://agnes-ai.com/en/docs/overview
- Mistral : https://docs.mistral.ai/inference/conversations/function-calling (exemples d’identifiants)
- CodeCraft : https://codecraftapi.com/docs/getting-started
- Z.ai : https://docs.z.ai/api-reference/introduction
- AgentRouter : https://agentrouter.org/docs/hermes.html
- Gemini : https://ai.google.dev/gemini-api/docs/openai
- Kira : https://kiraai.vn/models/kira-2.5-flash/ et https://kiraai.vn/models/kira-2.5-pro/ (exemples d’identifiants)
- APInex : https://apinex.bond/models/drex-v2-0
- RoutesMe : https://routesme.online/

Les URL sont documentées par les fournisseurs mais les appels de ce prototype n'ont été testés qu'avec des réponses simulées. Aucun contrat, licence de redistribution, disponibilité, prix ou service d'inférence effectif n'a été vérifié.
