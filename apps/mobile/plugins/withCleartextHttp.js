// Permite HTTP sin cifrar (http://192.168.x.x) también en compilaciones release.
// Solo para la fase de pruebas con el servidor en la red local: en producción el API va por HTTPS
// y este plugin se quita de app.json.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartextHttp(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
