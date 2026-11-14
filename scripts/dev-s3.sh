#!/usr/bin/env sh
# Start a real S3-compatible store (SeaweedFS) for tests, on 127.0.0.1 only.
#
# It needs S3_TEST_ACCESS_KEY and S3_TEST_SECRET_KEY in the environment: throwaway values for
# this container, never a real account's keys. The store checks request signatures against them.
#
#   sh scripts/dev-s3.sh start    # prints the endpoint when the store answers
#   sh scripts/dev-s3.sh stop
set -eu
IMAGE=chrislusf/seaweedfs@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0
NAME=holo-git-s3
PORT=${S3_TEST_PORT:-8333}
# On Windows, Git Bash rewrites arguments that look like paths. That must be off for the paths
# that belong to the container, and only for those commands.

if [ "${1:-start}" = stop ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  exit 0
fi

: "${S3_TEST_ACCESS_KEY:?set S3_TEST_ACCESS_KEY}" "${S3_TEST_SECRET_KEY:?set S3_TEST_SECRET_KEY}"
# A relative path, so Docker's own client can read it on every platform.
config=.s3-config.tmp.json
trap 'rm -f "$config"' EXIT
printf '{"identities":[{"name":"test","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}\n' \
  "$S3_TEST_ACCESS_KEY" "$S3_TEST_SECRET_KEY" >"$config"
docker rm -f "$NAME" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker create --name "$NAME" -p "127.0.0.1:$PORT:8333" "$IMAGE" server -s3 -s3.config=/s3.json >/dev/null
MSYS_NO_PATHCONV=1 docker cp "$config" "$NAME:/s3.json"
docker start "$NAME" >/dev/null
for _ in $(seq 1 150); do
  # Any HTTP answer, even a refusal, means the S3 gateway is up.
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then
    echo "http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 1
done
echo "the store did not start" >&2
docker logs "$NAME" 2>&1 | tail -20 >&2
exit 1
