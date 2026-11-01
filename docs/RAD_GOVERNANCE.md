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

## Historial

El backend central conserva mensajes visibles de usuario/asistente, sesiones, categorías, proyectos asociados, accesos y metadatos de herramientas MCP. La categoría inicial se calcula con reglas conservadoras y puede corregirse en RAD. La asociación a un proyecto también se puede realizar desde el detalle de la sesión en Gobernanza.

Los cambios se capturan en el servidor mediante eventos, aunque se cierre la pestaña. La cola local conserva identificadores pendientes y hashes; reintenta al recuperar conexión. Si la credencial RAD vence, se requiere iniciar sesión de nuevo para continuar sincronizando. El cierre de sesión revoca la cookie y cierra conexiones activas; no borra el historial central.

La entrada está pensada para la aplicación web local. Las herramientas de desarrollo y CLI originales siguen existiendo; para uso gobernado deben conectarse a una entrada autorizada. No publicar el Vite de desarrollo ni los puertos de los runtimes internos.

## Pruebas

Desde `packages/server`:

```powershell
bun typecheck
bun test test/rad-sync.test.ts test/rad-gateway.test.ts
```

La prueba del gateway abre runtimes reales con bases temporales y demuestra que una cuenta no puede leer sesiones de otra. La prueba de sincronización comprueba reintentos, eventos concurrentes y exclusión de razonamiento interno. El procedimiento no utiliza cuentas ni conversaciones reales.

En Windows, Git puede materializar `packages/app/src/custom-elements.d.ts` como texto en lugar del enlace a `packages/ui/src/custom-elements.d.ts`. Eso impide el typecheck del frontend. Para verificar localmente sin cambiar el enlace versionado, se puede materializar temporalmente el destino durante el check y restaurar los bytes originales después. No sustituir el enlace por otro archivo en un commit.
