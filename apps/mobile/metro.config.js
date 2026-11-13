// Expo SDK 52+ configura el monorepo automáticamente; aquí solo agregamos
// la resolución de imports ESM "./archivo.js" -> "./archivo.ts" en los paquetes
// compartidos del workspace (packages/*), que el API (Node ESM) necesita con extensión.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const packagesDir = path.resolve(__dirname, '../../packages');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && context.originModulePath.startsWith(packagesDir)) {
    try {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, '.ts'), platform);
    } catch {
      /* cae al resolver por defecto */
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Vista previa web (solo desarrollo): expo-sqlite carga un módulo WebAssembly.
// El navegador además necesita aislamiento entre orígenes (COOP/COEP) para usar SQLite.
if (!config.resolver.assetExts.includes('wasm')) config.resolver.assetExts.push('wasm');

module.exports = config;
