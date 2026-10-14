# Record a tutorial against the main checkout's dev server, passing the app's git
# commit into the container so versions.json can record it.
#
#   .\tutorial-videos\record.ps1 rrsp-optimizer.mjs --scene results
#   .\tutorial-videos\record.ps1 create-a-plan.mjs
#
# Everything after the script's own name is passed through to `node` in the container.

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot

# Main checkout = first entry of `git worktree list`.
$mainLine = git -C $here worktree list --porcelain | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1
if (-not $mainLine) { Write-Error 'Could not find the main checkout via git worktree list.'; exit 1 }
$main = $mainLine.Substring('worktree '.Length)

$commit = (git -C $main rev-parse --short HEAD).Trim()
$status = git -C $main status --porcelain
$dirty = '0'
if ($status) {
    $dirty = '1'
    Write-Warning "Main checkout ($main) has uncommitted changes: this recording won't match commit $commit exactly."
}
Write-Host "App: $main @ $commit (dirty=$dirty)"

$running = docker ps --filter 'name=^can-retire-app-1$' --format '{{.Names}}'
if ($running -ne 'can-retire-app-1') {
    Write-Error "Container can-retire-app-1 is not running. Start the dev server in the main checkout first: cd $main; docker compose up -d"
    exit 1
}

docker run --rm --network container:can-retire-app-1 `
    -e "TUT_APP_COMMIT=$commit" -e "TUT_APP_DIRTY=$dirty" -e TZ=America/Toronto `
    -v "${here}:/work/tutorials" can-retire-tutorials node @args
exit $LASTEXITCODE
