# Sends rm / Remove-Item targets to the Windows Recycle Bin, imitating rm's messages and exit code.
# Flags: -r -R --recursive -Recurse, -f --force -Force (clusters like -rf); others ignored; `--` ends flags.
Add-Type -AssemblyName Microsoft.VisualBasic
$recurse = $false; $force = $false; $flags = $true; $paths = @()
foreach ($a in $args) {
  $s = [string]$a
  if ($flags -and $s -eq '--') { $flags = $false; continue }
  if ($flags -and $s -match '^--?(recursive|recurse)$') { $recurse = $true; continue }
  if ($flags -and $s -match '^--?force$') { $force = $true; continue }
  if ($flags -and $s -cmatch '^-[A-Za-z]+$') { if ($s -cmatch '[rR]') { $recurse = $true }; if ($s -cmatch 'f') { $force = $true }; continue }
  if ($flags -and $s.StartsWith('--')) { continue }
  $paths += $s
}

$sent = 0; $failed = $false
function Fail([string]$p, [string]$why) { [Console]::Error.WriteLine("rm: cannot remove '$p': $why"); $script:failed = $true }

foreach ($p in $paths) {
  # Git Bash spells C:\x as /c/x; a bare /c is the drive root, not "current folder on C:".
  $q = $p -replace '^Microsoft\.PowerShell\.Core\\FileSystem::', '' -replace '^/([a-zA-Z])(?=/|$)', '$1:'
  if ($q -match '^[a-zA-Z]:$') { $q += '\' }
  try {
    # Always FullName: in-process, .NET's current folder is not PowerShell's location.
    $items = @(if ($q -and (Test-Path -LiteralPath $q)) { Get-Item -LiteralPath $q -Force } elseif ($q -match '[*?]') { Get-Item -Path $q -Force -ErrorAction SilentlyContinue })
  } catch { Fail $p $_.Exception.Message; continue }
  if (-not $items.Count) { if (-not $force) { Fail $p 'No such file or directory' }; continue }
  foreach ($i in $items) {
    $link = [bool]($i.Attributes -band [IO.FileAttributes]::ReparsePoint)
    if ($i.PSIsContainer -and -not $link -and -not $recurse) { Fail $p 'Is a directory'; continue }
    try {
      if ($i.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($i.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
      else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($i.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
      $sent++
    } catch { Fail $p $_.Exception.Message }
  }
}

if ($sent) {
  $what = if ($sent -eq 1) { 'item enviado' } else { 'itens enviados' }
  [Console]::Error.WriteLine("lixeira: $sent $what para a Lixeira do Windows")
}
exit [int]$failed
