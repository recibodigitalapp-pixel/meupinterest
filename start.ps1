$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Write-Error 'Node.js não foi encontrado. Instale o Node.js e execute este script novamente.'
  exit 1
}

$securePassword = Read-Host 'Digite a senha do mural para iniciar o servidor local' -AsSecureString
$credential = [System.Net.NetworkCredential]::new('', $securePassword)
$env:OWNER_USERNAME = 'juneba'
$env:OWNER_PASSWORD = $credential.Password

try {
  & $nodeCommand.Source (Join-Path $PSScriptRoot 'server.js')
}
finally {
  Remove-Item Env:OWNER_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:OWNER_USERNAME -ErrorAction SilentlyContinue
}
