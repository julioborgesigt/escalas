# Renomeia todas as migrations em ordem sequencial
# Resolve conflitos de numeração (ex: dois arquivos 0032, dois 0045)
# Uso: powershell -ExecutionPolicy Bypass -File .\scripts\renumber-migrations.ps1

$migrationsDir = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "migrations"
$files = Get-ChildItem $migrationsDir -Filter "*.sql" | Sort-Object Name

$counter = 1
foreach ($file in $files) {
    $newNum = "{0:D4}" -f $counter
    $oldName = $file.Name
    $suffix = $file.Name.Substring(4)  # "_algo.sql"
    $newName = "$newNum$suffix"

    if ($oldName -ne $newName) {
        $newPath = Join-Path $migrationsDir $newName
        Rename-Item $file.FullName $newPath
        Write-Host "REN: $oldName -> $newName"
    } else {
        Write-Host "OK:  $oldName"
    }
    $counter++
}

Write-Host ""
Write-Host "Renomeadas $($counter - 1) migrations sequencialmente."
