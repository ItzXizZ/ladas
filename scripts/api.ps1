# Dev helper: call the local API and wait for jobs.
#   . scripts\api.ps1;  $r = Api POST /api/products @{ url = 'example.com' };  $done = Wait-ReelJob $r.job.id
$base = 'http://127.0.0.1:5173'
function Api($method, $path, $body) {
  $p = @{ Method = $method; Uri = "$base$path"; TimeoutSec = 600 }
  if ($body) { $p.Body = [System.Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 30)); $p.ContentType = 'application/json; charset=utf-8' }
  Invoke-RestMethod @p
}
function Wait-ReelJob($id, $timeout = 900) {
  $t0 = Get-Date
  $last = ''
  while ($true) {
    $j = Api GET "/api/jobs/$id"
    if ($j.message -ne $last) { Write-Host ("[{0,3}%] {1}" -f [int]($j.progress * 100), $j.message); $last = $j.message }
    if ($j.status -ne 'running') { return $j }
    if (((Get-Date) - $t0).TotalSeconds -gt $timeout) { throw 'timed out' }
    Start-Sleep -Milliseconds 1200
  }
}
