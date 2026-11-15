$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$portableNode = "$root\.local\node\node-v22.14.0-win-x64"

if (Test-Path "$portableNode\node.exe") {
  $env:PATH = "$portableNode;$env:PATH"
}

Set-Location "$root\frontend"
npm run dev
