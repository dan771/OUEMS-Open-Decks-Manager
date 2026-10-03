$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$runtimeNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if ($nodeCommand) { $nodePath = $nodeCommand.Source }
elseif (Test-Path -LiteralPath $runtimeNode) { $nodePath = $runtimeNode }
else { throw 'Install Node.js 22 or later, then run npm run dev.' }
Push-Location $PSScriptRoot
try { & $nodePath server/dev.mjs } finally { Pop-Location }
