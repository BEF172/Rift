# Rift Atlas Tauri Releases

Rift Atlas usa el updater oficial de Tauri v2. No usa `latest.yml` ni
`electron-updater` para las builds Tauri.

## 1. Generar la key de updater

Ejecuta una sola vez:

```powershell
npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\rift-atlas.key"
```

El comando imprime una public key. En este repo ya quedo configurada en:

```json
"plugins.updater.pubkey"
```

La private key queda en `~/.tauri/rift-atlas.key`. El password local quedo en
`~/.tauri/rift-atlas.key.password`. No subas ninguno de esos archivos al repo.

## 2. Configurar GitHub Secrets

En GitHub: `Settings -> Secrets and variables -> Actions`.

Agrega:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

`TAURI_SIGNING_PRIVATE_KEY` puede ser el contenido de la private key o la ruta si
estas buildeando localmente. En GitHub Actions conviene usar el contenido.

Si generaste la key sin password, deja `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` vacio.

## 3. Publicar una version

Actualiza version en estos tres archivos:

```text
package.json
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
```

Luego crea y sube un tag:

```powershell
git tag v1.1.4
git push origin v1.1.4
```

El workflow `.github/workflows/release-tauri.yml` crea el GitHub Release y sube:

```text
Rift Atlas_*_x64-setup.exe
Rift Atlas_*_x64-setup.exe.sig
latest.json
```

La app consulta:

```text
https://github.com/BEF172/Rift/releases/latest/download/latest.json
```

## 4. Build local

Para generar artifacts localmente:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY=(Get-Content "$env:USERPROFILE\.tauri\rift-atlas.key" -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=(Get-Content "$env:USERPROFILE\.tauri\rift-atlas.key.password" -Raw)
npm run dist
```

Los archivos salen en:

```text
src-tauri/target/release/bundle/nsis/
```
