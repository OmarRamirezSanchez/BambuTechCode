# Identidad BambuTechCode

La primera entrega cambia la presentación del producto, manteniendo el motor de OpenCode. El roadmap de gobernanza queda fuera de esta etapa.

## Recursos de marca

Los SVG `bambu-logo.svg` y `bambu-logo-blanco.svg` proceden del proyecto de BambuTechServicesWebSite. Se preservó la geometría del logotipo oficial. Los recursos de marca pertenecen a sus respectivos titulares; la licencia del software no concede derechos sobre las marcas.

La interfaz usa los colores del sitio Bambu: verde `#52D93E`, fondo `#020402`, superficies `#070A07`, `#0D0F0D` y `#141814`. En modo claro, los enlaces y controles usan verde `#237915` para mantener contraste sobre blanco. Los estados de error, advertencia y éxito conservan su significado.

- `packages/ui/src/brand.ts`: geometría compartida del logotipo.
- `packages/ui/src/components/logo.tsx` y `src/typography/wordmark/wordmark.tsx`: logos de interfaz y arranque.
- `packages/ui/src/theme/themes/bambu.json`: tema claro y oscuro.
- `packages/app/src/new-session`: geometría Bambu en la animación y el juego existentes.
- `packages/desktop/icons/{dev,beta,prod}`: iconos PNG, ICO e ICNS derivados de `app-icon.svg`.
- `packages/tui/src/logo.ts` y `src/theme/assets/v2`: identidad de terminal.

`app-icon.svg` es la fuente vectorial del icono: el isotipo oficial sobre una placa oscura. Para regenerar PNG se puede renderizar con Sharp; usa las dimensiones de cada archivo de destino. Los ICO contienen PNG de 16, 32, 48, 64, 128 y 256 píxeles; los ICNS contienen PNG de 16 hasta 1024 píxeles. Mantén los tres canales y los favicons de `packages/ui` sincronizados.

## Límite del rebranding

No se reemplazan globalmente las cadenas `opencode`. Siguen siendo contratos técnicos en los paquetes, los proveedores, las URLs de autenticación, las variables de entorno, los esquemas, la configuración, los protocolos y el almacenamiento. Los servicios de OpenCode conservan su nombre y logotipo. Los créditos de autores y los avisos de licencia se preservan.

La aplicación de escritorio usa `com.bambutechservices.code`, con sufijos `.dev` y `.beta`, y se empaqueta como BambuTechCode. No instala el lanzador heredado de OpenCode en Linux. La compatibilidad de enlaces `opencode://` se conserva; el registro del esquema puede ser compartido con otras instalaciones de OpenCode.

## Compilación de distribuciones

La CLI y la aplicación se compilan juntas desde este fork. Construye primero el cliente web y la CLI del host; después el escritorio. No publiques con los workflows originales, diseñados para los registros y servicios de Anomaly.

```bash
bun run --cwd packages/app build
OPENCODE_CHANNEL=dev OPENCODE_VERSION=2.2.0-bambu.1 bun run --cwd packages/cli script/build.ts --single --skip-install
OPENCODE_CHANNEL=dev OPENCODE_VERSION=2.2.0-bambu.1 bun run --cwd packages/desktop build
OPENCODE_CHANNEL=dev OPENCODE_VERSION=2.2.0-bambu.1 bun run --cwd packages/desktop pack
```

Los instaladores requieren validación específica de plataforma y firma/notarización propia antes de una distribución general. No hay un canal de actualización Bambu publicado en esta etapa. El escritorio no consulta ni instala releases oficiales de OpenCode; para actualizar esta versión se usa el código del fork.

## Integrar cambios de upstream

```bash
git remote add upstream https://github.com/anomalyco/opencode.git # solo la primera vez
git fetch upstream
git switch -c sync-upstream
git merge upstream/dev
bun install --frozen-lockfile
bun run check
```

Revisa conflictos en la UI, identidad, temas y empaquetado. Mantén las modificaciones de gobernanza futuras separadas de este cambio visual. Base inicial: `589c62db60a4ae25e845e440eef64dd007101dc9`.
