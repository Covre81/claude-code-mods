# Dot-sourced by the lixeira mod before a PowerShell command: Remove-Item and its aliases (rm, del, erase, ri, rd, rmdir) send to the Recycle Bin.
function Remove-Item {
  [CmdletBinding(SupportsShouldProcess)]
  param(
    [Parameter(ValueFromPipeline, ValueFromPipelineByPropertyName, Position = 0)][Alias('FullName', 'PSPath', 'LiteralPath')][string[]]$Path,
    [switch]$Recurse,
    [switch]$Force
  )
  begin { $all = @() }
  process { $all += $Path }
  end {
    if (-not $all.Count -or -not $PSCmdlet.ShouldProcess($all -join ', ')) { return }
    $f = @()
    if ($Recurse) { $f += '-r' }
    if ($Force) { $f += '-f' }
    & (Join-Path $PSScriptRoot 'lixeira.ps1') @f -- @all   # `--`: a path starting with '-' stays a path
  }
}
