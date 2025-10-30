import os
import sys
import time
import threading
from fastapi import FastAPI, Response


def get_config_path() -> str:
    p = os.getenv("CONFIG_PATH")
    if not p:
        return "/etc/alert-example/config.yaml"
    return p


def read_config() -> str:
    path = get_config_path()
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


app = FastAPI()


@app.on_event("startup")
def startup_check() -> None:
    try:
        data = read_config()
        if "Crash" in data:
            print("ERROR: config contained Crash keyword on startup, terminating", file=sys.stderr)
            # Exit non-zero like the Go example
            sys.exit(1)
        else:
            print(f"INFO: data from config file: {data}")
    except Exception as e:
        print(f"WARN: could not read config on startup: {e}", file=sys.stderr)
        # Mirror Go example behavior: exit if startup read fails
        sys.exit(1)


@app.get("/healthz")
def healthz() -> Response:
    return Response(content="ok", media_type="text/plain; charset=utf-8")


@app.get("/config")
def get_config() -> Response:
    try:
        data = read_config()
    except Exception as e:
        print(f"ERROR: failed to read config file {get_config_path()}: {e}", file=sys.stderr)
        return Response(content="failed to read config", status_code=500)

    if "Crash" in data:
        print("ERROR: config contained Crash keyword, terminating", file=sys.stderr)

        def _delayed_exit() -> None:
            time.sleep(0.5)
            os._exit(1)

        threading.Thread(target=_delayed_exit, daemon=True).start()
        return Response(content="config triggered crash", status_code=500)

    return Response(content=data, media_type="text/plain; charset=utf-8")


