# Fixtures de test GTX

Les tests `test/geoid-gtx.test.mjs` construisent deux **grilles synthétiques en mémoire** pour contrôler l’endianness, les offsets candidats de 40/44 octets, l’interpolation bilinéaire, les limites de couverture et le calcul `H = h − N`.

Elles ne sont pas des modèles géoïdes NOAA/NGS publiés et ne prouvent pas l’interopérabilité avec tous les fichiers `.gtx` réels. Les entêtes GTX peuvent varier; avant tout usage opérationnel, vérifier la version, l’endianness, le datum vertical et la couverture du fichier fournisseur. L’application n’installe ni ne télécharge de modèle.
