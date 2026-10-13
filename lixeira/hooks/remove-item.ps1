# Dot-sourced by the lixeira mod before a PowerShell command: Remove-Item and its aliases (rm, del, erase, ri, rd, rmdir) send to the Recycle Bin.
function Remove-Item {
  [CmdletBinding(SupportsShouldProcess)]
  param(
    [Parameter(ValueFromPipeline, ValueFromPipelineByPropertyName, Position = 0)][Alias('FullName', 'PSPath', 'LiteralPath')][string[]]$Path,
    [string]$Filter,
    [string[]]$Include,
    [string[]]$Exclude,
    [switch]$Recurse,
    [switch]$Force
  )
  begin { $all = @() }
  process { $all += $Path }
  end {
    if (-not $all.Count -or -not $PSCmdlet.ShouldProcess($all -join ', ')) { return }
    # ponytail: refused rather than reimplemented; the pipe form below covers them.
    if ($Filter -or $Include -or $Exclude) {
      Write-Error 'lixeira: -Filter/-Include/-Exclude não suportados; nada foi apagado. Selecione com Get-ChildItem e mande pelo pipe para Remove-Item.'
      return
    }
    $files = @()
    foreach ($p in $all) {
      # Literal first (a name like [a].txt), then wildcards; hidden items only with -Force, like the real cmdlet.
      $found = @(if (Test-Path -LiteralPath $p) { Get-Item -LiteralPath $p -Force } else { Get-Item -Path $p -Force:$Force -ErrorAction SilentlyContinue })
      if (-not $found.Count) { $files += $p; continue }   # lixeira.ps1 reports it as missing
      foreach ($i in $found) {
        if ($i.PSProvider.Name -ne 'FileSystem') {
          # Env:, HKCU:, Function: have no Recycle Bin: the real cmdlet removes them.
          Microsoft.PowerShell.Management\Remove-Item -LiteralPath $i.PSPath -Recurse:$Recurse -Force:$Force -Confirm:$false
        } elseif ($i.PSIsContainer -and -not $Recurse -and -not ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -and (Get-ChildItem -LiteralPath $i.FullName -Force | Select-Object -First 1)) {
          Write-Error "lixeira: '$p' não está vazia; use -Recurse. Nada foi apagado."
        } else { $files += $i.FullName }
      }
    }
    if (-not $files.Count) { return }
    $f = @('-r')   # a non-empty folder without -Recurse was refused above; an empty one goes, like the real cmdlet
    if ($Force) { $f += '-f' }
    & (Join-Path $PSScriptRoot 'lixeira.ps1') @f -- @files   # `--`: a path starting with '-' stays a path
    if ($LASTEXITCODE) { Write-Error 'lixeira: algum item não foi para a Lixeira (ver acima).' }   # honours -ErrorAction Stop
  }
}
