#!/usr/bin/env bash
set -euo pipefail

url=${LLM_URL:-}
[[ -n "$url" ]] || exit 0

case "$url" in
  https://*)
    scheme=https://
    rest=${url#https://}
    add_path=true
    ;;
  http://*)
    scheme=http://
    rest=${url#http://}
    add_path=false
    ;;
  *://*)
    # Leave unfamiliar schemes to their caller.
    printf '%s\n' "$url"
    exit 0
    ;;
  *)
    scheme=
    rest=$url
    add_path=false
    ;;
esac

authority=${rest%%[/?#]*}
suffix=${rest#"$authority"}
if [[ -z "$authority" ]]; then
  printf '%s\n' "$url"
  exit 0
fi

# Ignore userinfo and bracketed IPv6 colons when checking for an explicit port.
host_port=${authority##*@}
has_port=false
case "$host_port" in
  \[*\]:[0-9]*) has_port=true ;;
  \[*\]) ;;
  *:[0-9]*) has_port=true ;;
esac

if [[ "$scheme" != https:// && "$has_port" == false ]]; then
  authority+=:8080
  add_path=true
fi

prefix=$scheme$authority
path=${suffix%%[?#]*}
tail=${suffix#"$path"}
if [[ "$add_path" == true && ( -z "$path" || "$path" == / ) ]]; then
  printf '%s/v1%s\n' "$prefix" "$tail"
else
  printf '%s%s\n' "$prefix" "$suffix"
fi
