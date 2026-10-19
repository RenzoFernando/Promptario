# Calidad del código

Promptario utiliza **Prettier** para el formato de HTML, CSS, JavaScript, JSON, JSONC, Markdown, SVG y XML; **ESLint** revisa los módulos JavaScript del frontend y el Worker.

## Instalación (Node.js 20 o posterior)

Desde la raíz del proyecto, en PowerShell:

```powershell
npm install
```

## Comandos

```powershell
npm run fix           # Formatear y aplicar correcciones automáticas seguras de ESLint
npm run format        # Solo aplicar Prettier
npm run lint          # Comprobar JavaScript
npm run lint:fix      # Corregir lo que ESLint puede resolver automáticamente
npm run check         # Verificar formato y lint, sin modificar archivos
```

**Primera ejecución:** `npm run fix` formatea todo el código compatible del proyecto, no solamente los archivos del ZIP. El resultado debe revisarse con `git diff` antes de publicar, porque el formato afecta muchas líneas aunque no altere la lógica. `npm install` genera `package-lock.json`; se recomienda incluirlo en Git.

El comando `npm run format` no procesa `*.ps1`, `*.sql` ni las reglas de Firestore: esos lenguajes no tienen soporte nativo de Prettier. Para formatear el administrador PowerShell se proporciona una tarea independiente basada en PSScriptAnalyzer:

```powershell
Install-Module PSScriptAnalyzer -Scope CurrentUser
.\scripts\format-powershell.ps1
```

Esta tarea no se ejecuta dentro de `npm run fix` para no exigir PowerShell y módulos adicionales a los equipos que solo trabajan con Node.js. Las consultas SQL y reglas de Firestore se dejan sin cambios para evitar reescrituras que puedan afectar al despliegue.

En WebStorm, habilita **Prettier → Run on save** apuntando al `package.json` del proyecto, y **ESLint → Automatic**. El archivo `.editorconfig` unifica la indentación.
