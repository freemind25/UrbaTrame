# UrbaTrame pour Android

Cette application Android ouvre le service UrbaTrame publié sur Vercel. Elle nécessite une connexion Internet; les données cartographiques et les fonctions serveur restent fournies par le site. Les exports créés par l’application sont enregistrés dans `Téléchargements/UrbaTrame`.

Pour générer l’APK de test signé automatiquement par Gradle :

```bash
./gradlew assembleDebug
```

APK produit : `app/build/outputs/apk/debug/app-debug.apk`. Cette signature de test permet l’installation directe, mais ne constitue pas une signature de publication Play Store.
