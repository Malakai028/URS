#!/usr/bin/env bash
# This test creates only anonymous Docker resources on the runner.
set -euo pipefail
export PUBLIC_ORIGIN=https://game.example.test
docker compose -f compose.production.yaml config --quiet
image="ure-ci:${GITHUB_SHA:-local}"
docker build --tag "$image" .
volume=$(docker volume create)
container=
cleanup() {
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null; fi
  docker volume rm "$volume" >/dev/null
}
trap cleanup EXIT
start() {
  container=$(docker run --detach --publish 127.0.0.1::4173 \
    --mount "type=volume,src=$volume,dst=/game/data" --env PUBLIC_ORIGIN "$image")
  endpoint="http://$(docker port "$container" 4173/tcp)"
  for _ in {1..30}; do
    if curl --silent --fail "$endpoint/healthz" | jq -e '.status == "ok"' >/dev/null; then return; fi
    sleep 1
  done
  docker logs --tail 30 "$container"
  return 1
}
post() {
  curl --silent --show-error --fail --header 'Content-Type: application/json' \
    --header "Origin: $PUBLIC_ORIGIN" --data-binary @- "$endpoint/api/auth/$1"
}
start
curl --silent --fail "$endpoint/" | grep -q 'id="root"'
pw=$(openssl rand -hex 32)
saved=$(jq -nc --arg pw "$pw" '{name:"container_ci",display:"Тестер",avatar:"leaf",accepted:true,
  email:"ci@example.test",password:$pw,confirmation:$pw}' | post register | jq -er '.id')
docker stop --time 12 "$container" >/dev/null
docker rm "$container" >/dev/null
container=
start
restored=$(jq -nc --arg pw "$pw" '{name:"container_ci",password:$pw}' | post login | jq -er '.id')
[[ "$restored" == "$saved" ]]
echo 'Production image served the app and restored the same test account.'
