<p align="center">
  <picture>
    <source srcset="branding/bambu-logo-blanco.svg" media="(prefers-color-scheme: dark)">
    <img src="branding/bambu-logo.svg" alt="BambuTechServices" width="240">
  </picture>
</p>

<h1 align="center">BambuTechCode</h1>
<p align="center">El agente de desarrollo de BambuTechServices, basado en OpenCode.</p>

Esta primera versión adapta la identidad visual de [OpenCode](https://github.com/anomalyco/opencode) a BambuTechServices. Conserva su motor, proveedores, herramientas, permisos, sesiones, API y plugins. La gobernanza de los procesos de desarrollo es la siguiente etapa; esta versión todavía no agrega reglas, aprobaciones ni controles de gobernanza.

Es un fork independiente. No está desarrollado, patrocinado ni respaldado por Anomaly Innovations, Inc. Se conservan la licencia MIT y los créditos originales. OpenCode Console, OpenCode Go y otros proveedores externos mantienen su identidad y condiciones.

## Ejecutar localmente

Requisito: **Bun 1.4.4**, la versión fijada por upstream.

```bash
git clone https://github.com/OmarRamirezSanchez/BambuTechCode.git
cd BambuTechCode
bun install --frozen-lockfile
bun run bambu
```

En macOS/Linux también puedes usar `./bambu`, que acepta los mismos argumentos que la CLI de OpenCode. Si existe `.tools/bun`, utiliza ese runtime local; de lo contrario utiliza Bun del PATH.

```bash
./bambu --help
./bambu /ruta/a/tu/proyecto
./bambu auth login
```

La conexión a modelos requiere las mismas credenciales o suscripciones que OpenCode. No se incluyen credenciales en el repositorio.

### Interfaz web

Ejecuta en dos terminales:

```bash
# Terminal 1, desde la raíz
./bambu serve --hostname 127.0.0.1 --port 4096

# Terminal 2, desde la raíz
bun run dev:web -- --host 127.0.0.1 --port 4444
```

Abre `http://localhost:4444`. El cliente usa el servidor local de OpenCode; puedes conectar proveedores y trabajar con los mismos proyectos y sesiones.

### Escritorio

```bash
bun run dev:desktop
```

La aplicación Electron se llama **BambuTechCode Dev** y utiliza un identificador propio. Su interfaz y backend se ejecutan desde este código fuente. Para construir instaladores, consulta [las notas del fork](branding/README.md) y [la guía de escritorio de upstream](packages/desktop/README.md).

## Compatibilidad

- Se mantienen `@opencode/*`, el comando técnico `opencode`, sus variables `OPENCODE_*`, formatos de configuración, protocolos y rutas de datos del motor.
- Las configuraciones existentes, MCP, skills y plugins siguen usando sus nombres originales.
- La CLI puede compartir configuración y datos con OpenCode según el canal. El nombre Bambu no implica aislamiento de sesiones del backend.
- La interfaz utiliza el tema Bambu por defecto; los temas elegidos previamente por el usuario se respetan.
- Las actualizaciones automáticas de escritorio están desactivadas hasta disponer de un canal de releases Bambu. La CLI también tiene desactivadas las actualizaciones automáticas; `upgrade` indica cómo actualizar desde el fork. Actualiza este fork desde Git y vuelve a instalar/compilar; el instalador oficial de OpenCode instala la distribución original.

## Desarrollo y validación

```bash
bun run check
cd packages/app && bun run build
```

Las pruebas se ejecutan desde cada paquete; no desde la raíz. Consulta [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) y las instrucciones de cada paquete.

Base inicial: rama `dev` de OpenCode, commit `589c62db60a4ae25e845e440eef64dd007101dc9` (29 de octubre de 2026), versión del monorepo `2.2.0`.

[Documentación original](README.upstream.md) · [Identidad y mantenimiento del fork](branding/README.md) · [Licencia MIT](LICENSE)
