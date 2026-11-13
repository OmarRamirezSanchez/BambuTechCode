# BambuTechCode con RAD

La entrada autenticada exige una cuenta activa de RAD antes de servir la interfaz, las APIs, los eventos o los WebSockets. Usa el inicio de sesión existente de RAD; no necesita otro proveedor de identidad.

## Inicio local

La API de uso de RAD debe estar disponible y tener aplicada la migración `20261101050000_governance_usage`. Consulta `RAD_Backend/scripts/usage/README.md` en el espacio de trabajo.

En una terminal, desde BambuTechCode:

```powershell
$env:VITE_RAD_GOVERNANCE='true'
bun run --cwd packages/app dev -- --host 127.0.0.1 --port 4445 --strictPort
```

En otra terminal:

```powershell
$env:RAD_CODE_ORIGIN='http://localhost:4332'
$env:RAD_WEB_ORIGIN='http://localhost:4318'
$env:RAD_USAGE_API='http://127.0.0.1:4324/api/projects/usage'
$env:RAD_CODE_DATA='C:\Users\reckn\Documents\GitHub\RAD\.local\bambutechcode-governance'
$env:RAD_CODE_VITE='http://127.0.0.1:4445'
bun run dev:rad
```

Abre **http://localhost:4332** y pulsa **Iniciar sesión con RAD**. La autorización vuelve mediante `postMessage` con origen y ventana comprobados y un desafío de un solo uso ligado a una cookie. El JWT no viaja en URLs, no se guarda en el navegador de BambuTechCode y no aparece en logs. La cookie de aplicación es HttpOnly y SameSite=Strict; en HTTPS también es Secure.

La configuración local de RAD permite expresamente localhost y 127.0.0.1 en el puerto 4332. Usa el mismo hostname del origen configurado. Un despliegue HTTPS requiere autorizar su origen exacto en RAD.

El menú RAD muestra la cuenta, acceso al historial y cierre de sesión. Un estado de sincronización pendiente indica que todavía hay información por enviar. Cada cuenta y ambiente utiliza una base de conversaciones y configuración separada. Las conversaciones antiguas del modo sin autenticación no se importan ni se atribuyen automáticamente.

## Modelos a través de BambuIAFrameWork

Con `BAMBU_IA_ORIGIN` definido, todo el consumo de modelos del runtime gobernado pasa por BambuIAFrameWork (proyecto `BambuTechIAFramework` del espacio de trabajo). Agrega la variable en la segunda terminal antes de `bun run dev:rad`:

```powershell
$env:BAMBU_IA_ORIGIN='http://127.0.0.1:8080'
```

Fuera de localhost la URL debe ser HTTPS. Sin la variable, el runtime se comporta como antes.

- **Inicio de sesión.** El gateway cambia el token de RAD por una consola del Framework (`/auth/exchange`) y la guarda en el runtime de la persona como credencial OAuth de la integración `bambu-ia`. El token de RAD no sale del gateway.
- **Renovación.** El plugin `bambu-ia` del core (`packages/core/src/plugin/provider/bambu-ia.ts`) renueva el token corto con el refresh token. Si el Framework rechaza la renovación, la integración pide volver a iniciar sesión con RAD.
- **Modelos y políticas.** El plugin descarga `/v1/config` al arrancar y cada minuto. Solo queda disponible el proveedor `bambu-ia`, con los modelos que RAD habilitó para la persona, y se aplican las reglas del arnés (`tool.use`, `integration.use`). El runtime también trae fija la política `provider.use` que niega cualquier otro proveedor, así que ningún proveedor local queda habilitado aunque el Framework no responda al arrancar.
- **Sesiones de trabajo.** Cada llamada al modelo lleva `x-bambu-session` con el ID de la sesión de BambuTechCode; el Framework agrupa el consumo y el historial con ese ID.
- **Cierre de sesión.** Al cerrar la última sesión de RAD de la persona, el gateway cierra la consola en el Framework (`/auth/logout`) y borra la credencial del runtime.
- **Estado.** `GET /api/experimental/rad/me` incluye `framework`: `disabled`, `connecting`, `connected` o `unavailable`. Si el intercambio falla, se reintenta en la siguiente solicitud, después de 30 segundos.

La sesión renovable dura como máximo `REFRESH_TTL_SECONDS` del Framework (12 h por defecto), más que las 8 h de la cookie del gateway. Una baja en RAD solo corta el acceso al instante si RAD Backend avisa al Framework (`/auth/revoke`).

Los modelos se habilitan, se asignan por rol o persona y se auditan en RAD, en **Gobernanza IA → Modelos IA** y **Consumo IA**. Para probar todo en local sin Dev ni AWS (RAD local, Framework con Bedrock simulado y esta entrada), ver `docs/E2E_GOBERNANZA_IA_LOCAL.md` en el espacio de trabajo de RAD.

## Historial

El backend central conserva mensajes visibles de usuario/asistente, sesiones, categorías, proyectos asociados, accesos y metadatos de herramientas MCP. La categoría inicial se calcula con reglas conservadoras y puede corregirse en RAD. La asociación a un proyecto también se puede realizar desde el detalle de la sesión en Gobernanza.

Los cambios se capturan en el servidor mediante eventos, aunque se cierre la pestaña. La cola local conserva identificadores pendientes y hashes; reintenta al recuperar conexión. Si la credencial RAD vence, se requiere iniciar sesión de nuevo para continuar sincronizando. El cierre de sesión revoca la cookie y cierra conexiones activas; no borra el historial central.

La entrada está pensada para la aplicación web local. Las herramientas de desarrollo y CLI originales siguen existiendo; para uso gobernado deben conectarse a una entrada autorizada. No publicar el Vite de desarrollo ni los puertos de los runtimes internos.

## Estructura de la sesión de trabajo

Cada runtime gobernado arranca con `experimental.session_brief` activo. Al primer prompt de una sesión nueva, y al primero después de que el usuario compacte una sesión, el servidor evalúa el texto contra la estructura requerida y registra el resultado como un mensaje sintético visible para el modelo y en la transcripción:

```markdown
## Objetivo :

## Descripción :

## Contexto :

## Criterios de Aceptación :
```

Si falta una sección o solo contiene el comentario de plantilla, el modelo no inicia la tarea: indica qué reforzar, sugiere un prompt completo con esa estructura y ofrece una entrevista breve para profundizar en contexto y objetivos. Si las cuatro secciones están presentes, verifica que sean suficientes y continúa. Los prompts posteriores de la misma sesión, las compactaciones automáticas y las sesiones de subagentes no se evalúan. La regla vive en `packages/core/src/session/brief.ts`; fuera del runtime gobernado se activa con `"experimental": { "session_brief": true }` en la configuración.

## Pruebas

Desde `packages/server`:

```powershell
bun typecheck
bun test test/rad-sync.test.ts test/rad-gateway.test.ts
```

Desde `packages/core`:

```powershell
bun test test/plugin/provider-bambu-ia.test.ts
```

La prueba del gateway abre runtimes reales con bases temporales y demuestra que una cuenta no puede leer sesiones de otra. Con un Framework simulado, también comprueba el intercambio al iniciar sesión, que el runtime solo ofrezca `bambu-ia`, que el token de RAD no llegue al runtime y el cierre de la consola al salir. La prueba del plugin cubre la renovación del token, la recarga cada minuto, el encabezado de sesión y el aviso para volver a iniciar sesión. La prueba de sincronización comprueba reintentos, eventos concurrentes y exclusión de razonamiento interno. El procedimiento no utiliza cuentas ni conversaciones reales.

En Windows, Git puede materializar `packages/app/src/custom-elements.d.ts` como texto en lugar del enlace a `packages/ui/src/custom-elements.d.ts`. Eso impide el typecheck del frontend. Para verificar localmente sin cambiar el enlace versionado, se puede materializar temporalmente el destino durante el check y restaurar los bytes originales después. No sustituir el enlace por otro archivo en un commit.
