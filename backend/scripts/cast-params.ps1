$files = Get-ChildItem -Path src -Recurse -Include *.ts
foreach ($f in $files) {
  $content = Get-Content -Raw -LiteralPath $f.FullName
  if ($content -eq $null) { continue }
  # 1) Reverse the backtracking corruption:
  #    req.query.branchI as stringd as string  ->  req.query.branchId as string
  $content = [regex]::Replace($content, '(req\.(?:params|query)\.[A-Za-z_][A-Za-z0-9_]*) as string([A-Za-z0-9_]) as ([A-Za-z_][A-Za-z0-9_]*)', '$1$2 as $3')
  # 2) Apply the correct transform with a word boundary so the capture group
  #    cannot backtrack into already-cast sites:
  #    req.params.id           -> req.params.id as string
  #    req.params.id as string -> untouched
  $content = [regex]::Replace($content, 'req\.(params|query)\.([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*as\b)', 'req.$1.$2 as string')
  [System.IO.File]::WriteAllText($f.FullName, $content)
}
Write-Output "DONE"